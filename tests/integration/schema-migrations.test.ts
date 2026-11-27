/**
 * The migrations are the schema. These tests run them against a real PostgreSQL (PGlite) and
 * read the result back out of the catalog, so the assertions describe the database itself
 * rather than a TypeScript re-statement of it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AUDIT_CATEGORIES,
  AUDIT_STAGES,
  AUDIT_STATUSES,
  FINDING_CONFIDENCES,
  FINDING_SOURCES,
  FINDING_STATUSES,
  METRIC_SOURCES,
  METRIC_UNITS,
  REPORT_STATUSES,
  SEVERITIES,
  USAGE_KINDS,
} from "@siteaudit/shared-types";

import { createTestDatabase, migrationFiles, type TestDatabase } from "../support/database.js";

const TABLES = [
  "profiles",
  "audits",
  "audit_pages",
  "audit_findings",
  "audit_metrics",
  "audit_reports",
  "usage_records",
] as const;

/** Read the string literals out of a CHECK constraint, e.g. `CHECK (status = ANY (ARRAY['a',...]))`. */
function constraintLiterals(definition: string): string[] {
  return [...definition.matchAll(/'([^']+)'::text/g)].map((match) => match[1] ?? "").sort();
}

async function constraintDefinitions(db: TestDatabase["db"]): Promise<Map<string, string>> {
  const { rows } = await db.query<{ conname: string; definition: string }>(
    `select conname, pg_get_constraintdef(oid) as definition
       from pg_constraint
      where connamespace = 'public'::regnamespace and contype = 'c'`,
  );
  return new Map(rows.map((row) => [row.conname, row.definition]));
}

/**
 * Everything about the schema that a reviewer would care about, with no OIDs and no timings,
 * so two databases migrated from the same files must produce the same string.
 */
async function schemaFingerprint(db: TestDatabase["db"]): Promise<string[]> {
  const { rows } = await db.query<{ line: string }>(`
    select line from (
      select 'column ' || table_name || '.' || column_name || ' ' || data_type ||
             coalesce('(' || character_maximum_length || ')', '') || ' null=' || is_nullable ||
             ' default=' || coalesce(column_default, '') as line
        from information_schema.columns where table_schema = 'public'
      union all
      select 'constraint ' || conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace
      union all
      select 'index ' || indexname || ' ' || indexdef
        from pg_indexes where schemaname = 'public'
      union all
      select 'policy ' || tablename || '.' || policyname || ' ' || cmd || ' to ' ||
             array_to_string(roles, '+') || ' using ' || coalesce(qual, '-') ||
             ' check ' || coalesce(with_check, '-')
        from pg_policies where schemaname = 'public'
      union all
      select 'trigger ' || event_object_table || '.' || trigger_name || ' ' || action_statement
        from information_schema.triggers where trigger_schema = 'public'
    ) as catalog
    order by line
  `);
  return rows.map((row) => row.line);
}

describe("supabase migrations", () => {
  let database: TestDatabase;
  let applied: string[];

  beforeAll(async () => {
    database = await createTestDatabase();
    applied = await database.migrate();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  it("applies every migration file in filename order", async () => {
    const files = await migrationFiles();
    expect(files).toEqual(applied);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      // Supabase CLI ordering: 14-digit timestamp, lowercase name, .sql.
      expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    }
  });

  it("creates all seven tables", async () => {
    const { rows } = await database.db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect(rows.map((row) => row.table_name).sort()).toEqual([...TABLES].sort());
  });

  it("reaches the same schema when applied to a second empty database", async () => {
    const other = await createTestDatabase();
    try {
      await other.migrate();
      expect(await schemaFingerprint(other.db)).toEqual(await schemaFingerprint(database.db));
    } finally {
      await other.close();
    }
  }, 60_000);

  it("mirrors every shared-types enum in a CHECK constraint", async () => {
    const constraints = await constraintDefinitions(database.db);

    const pairs: Array<[string, readonly string[]]> = [
      ["audits_status_valid", AUDIT_STATUSES],
      ["audits_stage_valid", AUDIT_STAGES],
      ["audit_findings_category_valid", AUDIT_CATEGORIES],
      ["audit_findings_severity_valid", SEVERITIES],
      ["audit_findings_source_valid", FINDING_SOURCES],
      ["audit_findings_confidence_valid", FINDING_CONFIDENCES],
      ["audit_findings_status_valid", FINDING_STATUSES],
      ["audit_metrics_category_valid", AUDIT_CATEGORIES],
      ["audit_metrics_source_valid", METRIC_SOURCES],
      ["audit_metrics_unit_valid", METRIC_UNITS],
      ["audit_metrics_status_valid", ["ok", "unavailable", "partial"]],
      ["audit_reports_status_valid", REPORT_STATUSES],
      ["usage_records_kind_valid", USAGE_KINDS],
    ];

    for (const [constraint, expected] of pairs) {
      const definition = constraints.get(constraint);
      expect(definition, `${constraint} is missing from the schema`).toBeDefined();
      expect(constraintLiterals(definition as string), `${constraint} disagrees with shared-types`).toEqual(
        [...expected].sort(),
      );
    }
  });

  it("enables row level security on every table and never widens a policy to anon", async () => {
    const { rows: security } = await database.db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );
    expect(security).toHaveLength(TABLES.length);
    for (const table of security) {
      expect(table.relrowsecurity, `${table.relname} has RLS disabled`).toBe(true);
    }

    const { rows: policies } = await database.db.query<{
      tablename: string;
      policyname: string;
      roles: string[];
    }>(`select tablename, policyname, roles::text[] from pg_policies where schemaname = 'public'`);
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      // `{public}` or `{anon}` would expose rows to a request without a user.
      expect(policy.roles, `${policy.tablename}.${policy.policyname} is not authenticated-only`).toEqual([
        "authenticated",
      ]);
    }

    for (const table of TABLES) {
      expect(
        policies.some((policy) => policy.tablename === table),
        `${table} has no policy`,
      ).toBe(true);
    }
  });

  it("creates the indexes TRD §13 asks for", async () => {
    const { rows } = await database.db.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public'`,
    );
    const names = new Set(rows.map((row) => row.indexname));
    for (const index of [
      "audits_user_created_idx",
      "audits_status_created_idx",
      "audit_findings_audit_idx",
      "audit_pages_audit_idx",
      "audit_metrics_audit_idx",
      "audit_reports_user_audit_idx",
      "usage_records_user_recorded_idx",
    ]) {
      expect(names, `${index} is missing`).toContain(index);
    }
  });

  it("refuses impossible rows instead of storing them", async () => {
    const userId = (
      await database.db.query<{ id: string }>(
        `insert into auth.users (email) values ('constraints@example.com') returning id`,
      )
    ).rows[0]?.id as string;

    const attempts: Array<[string, string]> = [
      [
        "private-scheme",
        `insert into public.audits (user_id, url, host) values ('${userId}','file:///etc/passwd','localhost')`,
      ],
      [
        "bad-status",
        `insert into public.audits (user_id, url, host, status) values ('${userId}','https://a.example','a.example','done')`,
      ],
      [
        "terminal-without-finish",
        `insert into public.audits (user_id, url, host, status) values ('${userId}','https://a.example','a.example','completed')`,
      ],
      [
        "max-pages-too-high",
        `insert into public.audits (user_id, url, host, max_pages) values ('${userId}','https://a.example','a.example',999)`,
      ],
    ];

    for (const [label, sql] of attempts) {
      await expect(database.db.exec(sql), label).rejects.toThrow();
    }

    // A queued audit with a finish time is equally wrong.
    await expect(
      database.db.exec(
        `insert into public.audits (user_id, url, host, completed_at) values ('${userId}','https://a.example','a.example', now())`,
      ),
    ).rejects.toThrow();
  });

  it("keeps an unavailable metric without a number", async () => {
    const userId = (
      await database.db.query<{ id: string }>(
        `insert into auth.users (email) values ('metrics@example.com') returning id`,
      )
    ).rows[0]?.id as string;
    const auditId = (
      await database.db.query<{ id: string }>(
        `insert into public.audits (user_id, url, host) values ($1,'https://m.example','m.example') returning id`,
        [userId],
      )
    ).rows[0]?.id as string;

    await expect(
      database.db.exec(
        `insert into public.audit_metrics (audit_id, category, metric_key, label, value, unit, source, status)
         values ('${auditId}','performance','lighthouse.lcp','LCP',2500,'ms','pagespeed','unavailable')`,
      ),
    ).rejects.toThrow(/audit_metrics_unavailable_has_no_value/);

    // The same metric, honestly unavailable, is accepted.
    await database.db.exec(
      `insert into public.audit_metrics (audit_id, category, metric_key, label, value, unit, source, status)
       values ('${auditId}','performance','lighthouse.lcp','LCP',null,'ms','pagespeed','unavailable')`,
    );
  });

  it("stores the page snapshot a crawl produces, and refuses impossible snapshots", async () => {
    const userId = (
      await database.db.query<{ id: string }>(
        `insert into auth.users (email) values ('pages@example.com') returning id`,
      )
    ).rows[0]?.id as string;
    const auditId = (
      await database.db.query<{ id: string }>(
        `insert into public.audits (user_id, url, host) values ($1,'https://p.example','p.example') returning id`,
        [userId],
      )
    ).rows[0]?.id as string;

    const pageId = (
      await database.db.query<{ id: string }>(
        `insert into public.audit_pages (audit_id, url, final_url, http_status, content_type, byte_size,
                                          duration_ms, title, parsed, fetched_at)
         values ($1,'https://p.example/','https://p.example/home',200,'text/html',1234,87,'Home',
                 '{"title":"Home","links":[]}'::jsonb, now()) returning id`,
        [auditId],
      )
    ).rows[0]?.id as string;
    expect(pageId).toBeTruthy();

    // A failure row carries a code instead of a page.
    await database.db.exec(
      `insert into public.audit_pages (audit_id, url, final_url, fetch_error)
       values ('${auditId}','https://p.example/gone','https://p.example/gone','unsafe_target')`,
    );

    const attempts: Array<[string, RegExp, string]> = [
      [
        "negative-duration",
        /audit_pages_duration_ms_range/,
        `insert into public.audit_pages (audit_id, url, final_url, duration_ms)
         values ('${auditId}','https://p.example/neg','https://p.example/neg',-1)`,
      ],
      [
        "error-with-prose",
        /audit_pages_fetch_error_shape/,
        // Exception text would leak an address; the column only accepts a code.
        `insert into public.audit_pages (audit_id, url, final_url, fetch_error)
         values ('${auditId}','https://p.example/prose','https://p.example/prose','connect ECONNREFUSED 10.0.0.1:80')`,
      ],
      [
        "parsed-array",
        /audit_pages_parsed_object/,
        `insert into public.audit_pages (audit_id, url, final_url, parsed)
         values ('${auditId}','https://p.example/arr','https://p.example/arr','[]'::jsonb)`,
      ],
      [
        "final-url-required",
        /null value in column "final_url"/,
        `insert into public.audit_pages (audit_id, url) values ('${auditId}','https://p.example/nofinal')`,
      ],
    ];

    for (const [label, pattern, sql] of attempts) {
      await expect(database.db.exec(sql), label).rejects.toThrow(pattern);
    }
  });

  it("refuses a finished audit without a score, and a score outside 0-100", async () => {
    const userId = (
      await database.db.query<{ id: string }>(
        `insert into auth.users (email) values ('scores@example.com') returning id`,
      )
    ).rows[0]?.id as string;

    // A completed audit is a claim that results exist. It must carry the number and the version
    // of the formula, or the claim is unsupported.
    await expect(
      database.db.exec(
        `insert into public.audits (user_id, url, host, status, completed_at)
         values ('${userId}','https://s.example','s.example','completed', now())`,
      ),
    ).rejects.toThrow(/audits_finished_has_score/);

    await expect(
      database.db.exec(
        `insert into public.audits (user_id, url, host, status, completed_at, overall_score, scoring_version)
         values ('${userId}','https://s.example','s.example','completed', now(), 101, 'rules-v1')`,
      ),
    ).rejects.toThrow(/audits_overall_score_range/);

    await expect(
      database.db.exec(
        `insert into public.audits (user_id, url, host, status, created_at)
         values ('${userId}','https://s.example','s.example','cancelled', now())
         returning id`,
      ),
    ).rejects.toThrow();

    // The same row, honest, is accepted.
    await database.db.exec(
      `insert into public.audits
         (user_id, url, host, status, completed_at, overall_score, category_scores, scoring_version)
       values ('${userId}','https://ok.example','ok.example','completed', now(), 82,
               '[{"category":"seo","score":76,"weight":25}]'::jsonb, 'rules-v1')`,
    );

    // A failed audit carries no score: it measured nothing to score.
    await database.db.exec(
      `insert into public.audits (user_id, url, host, status, completed_at, error_code)
       values ('${userId}','https://bad.example','bad.example','failed', now(), 'target_unreachable')`,
    );
  });

  it("deduplicates findings per audit, issue code and page scope", async () => {
    const userId = (
      await database.db.query<{ id: string }>(
        `insert into auth.users (email) values ('dedupe@example.com') returning id`,
      )
    ).rows[0]?.id as string;
    const auditId = (
      await database.db.query<{ id: string }>(
        `insert into public.audits (user_id, url, host) values ($1,'https://d.example','d.example') returning id`,
        [userId],
      )
    ).rows[0]?.id as string;

    const insert = `insert into public.audit_findings
      (audit_id, issue_code, category, severity, title, description, evidence, source, confidence)
      values ('${auditId}','missing-title','seo','high','Missing title','No <title>.','{}','rule','observed')`;

    await database.db.exec(insert);
    await expect(database.db.exec(insert)).rejects.toThrow(/audit_findings_dedupe/);
  });
});
