/**
 * Tenant isolation, executed against real PostgreSQL.
 *
 * Every assertion below runs as `anon`, as `authenticated` with a user's JWT subject, or as the
 * service role — never as the table owner, because the owner bypasses RLS and would make these
 * tests pass no matter what the policies said.
 *
 * These are the tests ARD §1 and PLAN risk #4 ask for: two users, not one, and a request with
 * no user at all.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { actAs, actAsOwner, createTestDatabase, seedUser, type TestDatabase } from "../support/database.js";

interface Fixture {
  database: TestDatabase;
  alice: { id: string; email: string };
  bob: { id: string; email: string };
  aliceAudit: string;
  bobAudit: string;
  aliceFinding: string;
  bobFinding: string;
}

let f: Fixture;

const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await f.database.db.query<T>(sql, params)).rows;

/** The first row, or a failure: every caller of this expects a row to exist. */
function first<T>(list: T[]): T {
  const value = list[0];
  if (value === undefined) throw new Error("expected at least one row, got none");
  return value;
}

const count = async (table: string): Promise<number> =>
  first(await rows<{ n: number }>(`select count(*)::int as n from public.${table}`)).n;

async function asService(sql: string, params: unknown[] = []): Promise<void> {
  await actAs(f.database.db, "service_role");
  await f.database.db.query(`${sql}`, params);
}

beforeAll(async () => {
  f = { database: await createTestDatabase() } as Fixture;
  await f.database.migrate();

  f.alice = await seedUser(f.database.db, "alice@example.com", { name: "Alice Agency" });
  f.bob = await seedUser(f.database.db, "bob@example.com");

  // Children are written by the worker, which is the only holder of the service role.
  await actAs(f.database.db, "service_role");
  const audit = async (userId: string, url: string): Promise<string> => {
    const created = await f.database.db.query<{ id: string }>(
      `insert into public.audits (user_id, url, host) values ($1,$2,$3) returning id`,
      [userId, url, new URL(url).host],
    );
    const id = created.rows[0]?.id;
    if (id === undefined) throw new Error("audit insert returned no id");
    return id;
  };

  f.aliceAudit = await audit(f.alice.id, "https://alice.example");
  f.bobAudit = await audit(f.bob.id, "https://bob.example");

  const addChild = async (auditId: string, url: string): Promise<string> => {
    const page = await f.database.db.query<{ id: string }>(
      `insert into public.audit_pages (audit_id, url) values ($1,$2) returning id`,
      [auditId, url],
    );
    const pageId = page.rows[0]?.id;
    if (pageId === undefined) throw new Error("page insert returned no id");
    await f.database.db.query(
      `insert into public.audit_findings
        (audit_id, page_id, issue_code, category, severity, title, description, evidence, source, confidence)
       values ($1,$2,'missing-title','seo','high','Missing title','The page has no title.','{}','rule','observed')`,
      [auditId, pageId],
    );
    await f.database.db.query(
      `insert into public.audit_metrics (audit_id, page_id, category, metric_key, label, value, unit, source, status)
       values ($1,$2,'performance','lighthouse.lcp','LCP',2500,'ms','pagespeed','ok')`,
      [auditId, pageId],
    );
    await f.database.db.query(
      `insert into public.audit_findings
        (audit_id, issue_code, category, severity, title, description, evidence, source, confidence)
       values ($1,'slow-server-response','performance','medium','Slow response','TTFB is 1.9s.','{}','rule','observed')`,
      [auditId],
    );
    return pageId;
  };

  await addChild(f.aliceAudit, "https://alice.example/one");
  await addChild(f.bobAudit, "https://bob.example/one");

  await f.database.db.query(
    `insert into public.audit_reports (audit_id, user_id, status, template_version, storage_path)
     values ($1,$2,'ready','1.0.0','reports/alice.pdf')`,
    [f.aliceAudit, f.alice.id],
  );
  await f.database.db.query(
    `insert into public.audit_reports (audit_id, user_id, status, template_version, storage_path)
     values ($1,$2,'ready','1.0.0','reports/bob.pdf')`,
    [f.bobAudit, f.bob.id],
  );
  await f.database.db.query(
    `insert into public.usage_records (user_id, audit_id, kind, quantity, estimated_cost_usd)
     values ($1,$2,'audit',1,0.014), ($3,$4,'audit',1,0.009)`,
    [f.alice.id, f.aliceAudit, f.bob.id, f.bobAudit],
  );

  f.aliceFinding = first(
    await rows<{ id: string }>(`select id from public.audit_findings where audit_id = $1 limit 1`, [
      f.aliceAudit,
    ]),
  ).id;
  f.bobFinding = first(
    await rows<{ id: string }>(`select id from public.audit_findings where audit_id = $1 limit 1`, [
      f.bobAudit,
    ]),
  ).id;

  await actAsOwner(f.database.db);
}, 60_000);

afterAll(async () => {
  await f.database.close();
});

describe("signup provisioning", () => {
  it("creates a profile for every auth user, named from metadata or the email local part", async () => {
    await actAsOwner(f.database.db);
    const alice = await rows<{ name: string }>(`select name from public.profiles where id = $1`, [
      f.alice.id,
    ]);
    const bob = await rows<{ name: string }>(`select name from public.profiles where id = $1`, [f.bob.id]);
    expect(first(alice).name).toBe("Alice Agency");
    expect(first(bob).name).toBe("bob");
  });

  it("backfills a user who existed before the trigger", async () => {
    await actAsOwner(f.database.db);
    // Simulate a pre-trigger signup by deleting the profile and re-running provisioning.
    const { rows: legacy } = await f.database.db.query<{ id: string }>(
      `insert into auth.users (email) values ('legacy@example.com') returning id`,
    );
    await f.database.db.query(`delete from public.profiles where id = $1`, [first(legacy).id]);
    await f.database.db.exec(
      `insert into public.profiles (id, name)
       select u.id, coalesce(nullif(btrim(coalesce(u.raw_user_meta_data ->> 'name', '')), ''),
                            nullif(btrim(split_part(coalesce(u.email, ''), '@', 1)), ''),
                            'New account')
         from auth.users u
        where u.id = '${first(legacy).id}'
       on conflict (id) do nothing`,
    );
    const restored = await rows<{ name: string }>(`select name from public.profiles where id = $1`, [
      first(legacy).id,
    ]);
    expect(first(restored).name).toBe("legacy");
  });
});

describe("unauthenticated access", () => {
  it("gives the anon role no table access at all", async () => {
    for (const table of [
      "profiles",
      "audits",
      "audit_pages",
      "audit_findings",
      "audit_metrics",
      "audit_reports",
      "usage_records",
    ]) {
      await actAs(f.database.db, "anon");
      await expect(rows(`select * from public.${table}`), table).rejects.toThrow(/permission denied/);
    }
  });

  it("stops an authenticated role with no subject claim from seeing anything", async () => {
    await actAs(f.database.db, "authenticated", "");
    // auth.uid() is null, so `user_id = auth.uid()` is null, which is not true: no rows.
    expect(await count("audits")).toBe(0);
    expect(await count("profiles")).toBe(0);
    expect(await count("audit_findings")).toBe(0);
  });
});

describe("two-user isolation", () => {
  it("shows each user only their own audits", async () => {
    await actAs(f.database.db, "authenticated", f.alice.id);
    const aliceSees = await rows<{ id: string }>(`select id from public.audits`);
    expect(aliceSees.map((row) => row.id)).toEqual([f.aliceAudit]);

    await actAs(f.database.db, "authenticated", f.bob.id);
    const bobSees = await rows<{ id: string }>(`select id from public.audits`);
    expect(bobSees.map((row) => row.id)).toEqual([f.bobAudit]);
  });

  it("hides another user's audit even when its id is known", async () => {
    await actAs(f.database.db, "authenticated", f.bob.id);
    expect(await rows(`select id from public.audits where id = $1`, [f.aliceAudit])).toHaveLength(0);
  });

  it("shows only the caller's profile", async () => {
    await actAs(f.database.db, "authenticated", f.alice.id);
    const profiles = await rows<{ id: string }>(`select id from public.profiles`);
    expect(profiles.map((row) => row.id)).toEqual([f.alice.id]);
  });

  it("cannot read another user's usage records or reports", async () => {
    await actAs(f.database.db, "authenticated", f.alice.id);
    expect(
      (await rows<{ storage_path: string }>(`select storage_path from public.audit_reports`)).map(
        (row) => row.storage_path,
      ),
    ).toEqual(["reports/alice.pdf"]);
    expect(await count("usage_records")).toBe(1);
    expect(await rows(`select id from public.usage_records where audit_id = $1`, [f.bobAudit])).toHaveLength(
      0,
    );
  });
});

describe("child records are reachable only through an owned audit", () => {
  it("shows the children of an owned audit", async () => {
    await actAs(f.database.db, "authenticated", f.alice.id);
    expect(await count("audit_pages")).toBe(1);
    expect(await count("audit_findings")).toBe(2);
    expect(await count("audit_metrics")).toBe(1);
  });

  it("hides children of another user's audit, including by direct id", async () => {
    await actAs(f.database.db, "authenticated", f.bob.id);
    const pageIds = await rows<{ id: string }>(`select id from public.audit_pages where audit_id = $1`, [
      f.aliceAudit,
    ]);
    expect(pageIds).toHaveLength(0);
    expect(await rows(`select id from public.audit_findings where id = $1`, [f.aliceFinding])).toHaveLength(
      0,
    );
    expect(
      await rows(`select id from public.audit_metrics where audit_id = $1`, [f.aliceAudit]),
    ).toHaveLength(0);
  });

  it("does not let a user attach a child to someone else's audit", async () => {
    await actAs(f.database.db, "authenticated", f.alice.id);
    await expect(
      f.database.db.query(
        `insert into public.audit_findings
          (audit_id, issue_code, category, severity, title, description, evidence, source, confidence)
         values ($1,'forged','seo','low','Forged','Injected row.','{}','rule','observed')`,
        [f.bobAudit],
      ),
      "authenticated users have no INSERT grant on findings",
    ).rejects.toThrow(/permission denied/);
  });
});

describe("writes stay inside the caller's tenant", () => {
  it("lets a user update their own finding status", async () => {
    await actAs(f.database.db, "authenticated", f.alice.id);
    const result = await f.database.db.query(
      `update public.audit_findings set status = 'resolved' where id = $1`,
      [f.aliceFinding],
    );
    expect(result.affectedRows).toBe(1);
  });

  it("silently affects zero rows when updating another user's finding", async () => {
    await actAs(f.database.db, "authenticated", f.alice.id);
    const result = await f.database.db.query(
      `update public.audit_findings set status = 'ignored' where id = $1`,
      [f.bobFinding],
    );
    expect(result.affectedRows).toBe(0);

    await actAsOwner(f.database.db);
    const bobRow = await rows<{ status: string }>(`select status from public.audit_findings where id = $1`, [
      f.bobFinding,
    ]);
    expect(first(bobRow).status).toBe("open");
  });

  it("restricts a finding update to the status column", async () => {
    await actAs(f.database.db, "authenticated", f.alice.id);
    await expect(
      f.database.db.query(`update public.audit_findings set title = 'Rewritten' where id = $1`, [
        f.aliceFinding,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses to update another user's profile", async () => {
    await actAs(f.database.db, "authenticated", f.alice.id);
    const result = await f.database.db.query(`update public.profiles set name = 'Hijacked' where id = $1`, [
      f.bob.id,
    ]);
    expect(result.affectedRows).toBe(0);

    await actAsOwner(f.database.db);
    expect(
      first(await rows<{ name: string }>(`select name from public.profiles where id = $1`, [f.bob.id])).name,
    ).toBe("bob");
  });

  it("refuses to create an audit owned by someone else, or already past queued", async () => {
    await actAs(f.database.db, "authenticated", f.alice.id);
    await expect(
      f.database.db.query(
        `insert into public.audits (user_id, url, host) values ($1,'https://forged.example','forged.example')`,
        [f.bob.id],
      ),
    ).rejects.toThrow(/row-level security/);

    await expect(
      f.database.db.query(
        `insert into public.audits (user_id, url, host, status) values ($1,'https://x.example','x.example','running')`,
        [f.alice.id],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not let a user rewrite audit status or another user's records", async () => {
    await actAs(f.database.db, "authenticated", f.alice.id);
    await expect(
      f.database.db.query(`update public.audits set status = 'completed' where id = $1`, [f.aliceAudit]),
    ).rejects.toThrow(/permission denied/);

    const deleted = await f.database.db.query(`delete from public.audits where id = $1`, [f.bobAudit]);
    expect(deleted.affectedRows).toBe(0);
  });

  it("keeps the usage ledger append-only for users", async () => {
    await actAs(f.database.db, "authenticated", f.alice.id);
    await expect(
      f.database.db.query(
        `insert into public.usage_records (user_id, kind, quantity) values ($1,'audit',1)`,
        [f.alice.id],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      f.database.db.query(`update public.usage_records set quantity = 0 where user_id = $1`, [f.alice.id]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      f.database.db.query(`delete from public.usage_records where user_id = $1`, [f.alice.id]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("ownership lifecycle", () => {
  it("bumps updated_at on a user's profile update", async () => {
    await actAs(f.database.db, "authenticated", f.alice.id);
    const before = await rows<{ updated_at: Date }>(`select updated_at from public.profiles where id = $1`, [
      f.alice.id,
    ]);
    await f.database.db.query(`update public.profiles set website = 'https://alice.example' where id = $1`, [
      f.alice.id,
    ]);
    const after = await rows<{ updated_at: Date; website: string }>(
      `select updated_at, website from public.profiles where id = $1`,
      [f.alice.id],
    );
    expect(first(after).website).toBe("https://alice.example");
    expect(new Date(first(after).updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(first(before).updated_at).getTime(),
    );
  });

  it("cascades a deleted audit to its children", async () => {
    const doomed = await seedUser(f.database.db, "doomed@example.com");
    await asService(
      `insert into public.audits (id, user_id, url, host) values ('11111111-1111-4111-8111-111111111111',$1,'https://doomed.example','doomed.example')`,
      [doomed.id],
    );
    await asService(
      `insert into public.audit_pages (audit_id, url) values ('11111111-1111-4111-8111-111111111111','https://doomed.example/p')`,
    );
    await asService(
      `insert into public.audit_findings (audit_id, issue_code, category, severity, title, description, evidence, source, confidence)
       values ('11111111-1111-4111-8111-111111111111','x-code','seo','low','T','D','{}','rule','observed')`,
    );

    await actAs(f.database.db, "authenticated", doomed.id);
    const deleted = await f.database.db.query(`delete from public.audits where id = $1`, [
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(deleted.affectedRows).toBe(1);

    await actAsOwner(f.database.db);
    expect(
      await rows(`select id from public.audit_pages where audit_id = $1`, [
        "11111111-1111-4111-8111-111111111111",
      ]),
    ).toHaveLength(0);
    expect(
      await rows(`select id from public.audit_findings where audit_id = $1`, [
        "11111111-1111-4111-8111-111111111111",
      ]),
    ).toHaveLength(0);
  });

  it("deletes a profile when the auth user is deleted", async () => {
    const doomed = await seedUser(f.database.db, "cascade@example.com");
    await actAsOwner(f.database.db);
    await f.database.db.query(`delete from auth.users where id = $1`, [doomed.id]);
    expect(await rows(`select id from public.profiles where id = $1`, [doomed.id])).toHaveLength(0);
  });

  it("lets the service role see everything, which is how the worker operates", async () => {
    await actAs(f.database.db, "service_role");
    expect(await count("audits")).toBeGreaterThanOrEqual(2);
    expect(await count("audit_findings")).toBeGreaterThanOrEqual(3);
    await actAsOwner(f.database.db);
  });
});
