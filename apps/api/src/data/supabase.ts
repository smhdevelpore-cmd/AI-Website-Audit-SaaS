/**
 * The Supabase implementation of `UserData`.
 *
 * One client per request, authorised with the **caller's** access token and the anon key. The
 * service-role key is deliberately absent from this file: nothing in a request path may run
 * with privileges that ignore RLS, or a missing filter becomes a cross-tenant read.
 *
 * This is why the API can create and delete audits without a privileged key at all: the schema
 * grants `authenticated` exactly `select`, `insert` (queued rows, owned by the caller) and
 * `delete` (own rows). Status updates belong to the worker, which is the only holder of the
 * service-role key.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@siteaudit/shared-types";

import type {
  AuditListQuery,
  FindingRow,
  MetricRow,
  PageRowSummary,
  AuditListResult,
  AuditRow,
  NewAuditRow,
  ProfilePatch,
  ProfileRow,
  UserData,
  UserDataFactory,
} from "./types.js";

const PROFILE_COLUMNS = "id,name,agency_name,website,timezone,logo_url,created_at,updated_at";
const AUDIT_COLUMNS =
  "id,user_id,url,host,client_name,project_name,status,stage,max_pages,pages_scanned," +
  "was_partial,scoring_version,overall_score,category_scores,error_code,error_message," +
  "ai_status,ai_model,ai_summary,metrics_status,metrics_reason,metrics_strategy," +
  "metrics_provider_version,metrics_measured_at,started_at,completed_at,created_at,updated_at";

const METRIC_COLUMNS =
  "id,audit_id,page_id,category,metric_key,label,value,unit,source,status,strategy," +
  "provider_version,measured_at,reason";

/**
 * Findings with their page, flattened by the embed. `audit_pages(url)` is a to-one relation
 * (many findings, one page), so PostgREST returns an object rather than an array.
 */
const FINDING_COLUMNS =
  "id,audit_id,page_id,issue_code,category,severity,title,description,evidence,recommendation," +
  "source,status,ai_explanation,page:audit_pages(url)";

const ACTIVE_STATUSES = ["queued", "running"] as const;

function failed(operation: string, error: { message: string; code?: string } | null): never {
  // The PostgREST message can contain column names; it is for logs, not for the client.
  throw new AppError("internal_error", "We could not reach the database.", {
    logContext: { operation, databaseCode: error?.code, databaseMessage: error?.message },
    cause: error,
  });
}

/**
 * PostgREST's `or=` grammar treats `,` `.` `(` `)` as syntax and `*` `%` `_` as wildcards.
 * A search box is user input, not a filter expression, so every one of those is stripped
 * before the term is interpolated. Whatever survives is a plain substring.
 */
export function escapeSearchTerm(term: string): string {
  return term
    .replace(/[,()"'\\%_*]/g, " ")
    .trim()
    .slice(0, 200);
}

export interface SupabaseUserDataOptions {
  readonly url: string;
  readonly anonKey: string;
  /** Replaced in tests so the request can be inspected without a network. */
  readonly fetch?: typeof globalThis.fetch;
}

export function createSupabaseUserDataFactory(options: SupabaseUserDataOptions): UserDataFactory {
  return (accessToken: string): UserData => {
    const client: SupabaseClient = createClient(options.url, options.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      },
    });

    return {
      async findProfile(userId) {
        const { data, error } = await client
          .from("profiles")
          .select(PROFILE_COLUMNS)
          .eq("id", userId)
          .maybeSingle<ProfileRow>();
        if (error) failed("profiles.select", error);
        return data ?? null;
      },

      async updateProfile(userId, patch: ProfilePatch) {
        const { data, error } = await client
          .from("profiles")
          .update(patch)
          .eq("id", userId)
          .select(PROFILE_COLUMNS)
          .maybeSingle<ProfileRow>();
        if (error) failed("profiles.update", error);
        return data ?? null;
      },

      async findAudit(auditId) {
        const { data, error } = await client
          .from("audits")
          .select(AUDIT_COLUMNS)
          .eq("id", auditId)
          .maybeSingle<AuditRow>();
        if (error) failed("audits.select", error);
        return data ?? null;
      },

      async createAudit(userId, input: NewAuditRow) {
        const { data, error } = await client
          .from("audits")
          .insert({
            user_id: userId,
            url: input.url,
            host: input.host,
            client_name: input.clientName,
            project_name: input.projectName,
            max_pages: input.maxPages,
            status: "queued",
          })
          .select(AUDIT_COLUMNS)
          .maybeSingle<AuditRow>();
        if (error) failed("audits.insert", error);
        if (data === null) {
          // RLS refused the insert: `with check` did not match, which means caller and owner
          // disagree. That is a bug in the caller, not a data condition.
          throw new AppError("forbidden", "That audit cannot be created for this account.", {
            logContext: { reason: "insert_rejected", userId },
          });
        }
        return data;
      },

      async listAudits(userId: string, query: AuditListQuery): Promise<AuditListResult> {
        const from = (query.page - 1) * query.limit;
        const to = from + query.limit - 1;

        let builder = client
          .from("audits")
          .select(AUDIT_COLUMNS, { count: "exact" })
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .range(from, to);

        if (query.status !== undefined) builder = builder.eq("status", query.status);

        const term = query.search === undefined ? "" : escapeSearchTerm(query.search);
        if (term !== "") {
          builder = builder.or(
            [
              `url.ilike.%${term}%`,
              `host.ilike.%${term}%`,
              `client_name.ilike.%${term}%`,
              `project_name.ilike.%${term}%`,
            ].join(","),
          );
        }

        const { data, error, count } = await builder.returns<AuditRow[]>();
        if (error) failed("audits.list", error);
        return { rows: data ?? [], total: count ?? (data ?? []).length };
      },

      async countAuditsSince(userId: string, since: Date) {
        const { count, error } = await client
          .from("audits")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("created_at", since.toISOString());
        if (error) failed("audits.count", error);
        return count ?? 0;
      },

      async findActiveAudit(userId: string, url: string) {
        const { data, error } = await client
          .from("audits")
          .select(AUDIT_COLUMNS)
          .eq("user_id", userId)
          .eq("url", url)
          .in("status", [...ACTIVE_STATUSES])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<AuditRow>();
        if (error) failed("audits.findActive", error);
        return data ?? null;
      },

      async listFindings(auditId: string) {
        // Ordered by the columns that are stable; the severity order a person reads is applied
        // in the route, because `order=severity` sorts the words alphabetically.
        const { data, error } = await client
          .from("audit_findings")
          .select(FINDING_COLUMNS)
          .eq("audit_id", auditId)
          .order("issue_code", { ascending: true })
          .order("id", { ascending: true })
          .returns<FindingRow[]>();
        if (error) failed("audit_findings.select", error);
        return data ?? [];
      },

      async listMetrics(auditId: string) {
        const { data, error } = await client
          .from("audit_metrics")
          .select(METRIC_COLUMNS)
          .eq("audit_id", auditId)
          .order("category", { ascending: true })
          .order("metric_key", { ascending: true })
          .returns<MetricRow[]>();
        if (error) failed("audit_metrics.select", error);
        return data ?? [];
      },

      async listPageSummaries(auditId: string) {
        const { data, error } = await client
          .from("audit_pages")
          .select("url,fetch_error")
          .eq("audit_id", auditId)
          .order("depth", { ascending: true })
          .order("url", { ascending: true })
          .returns<PageRowSummary[]>();
        if (error) failed("audit_pages.select", error);
        return data ?? [];
      },

      async deleteAudit(auditId: string) {
        const { data, error } = await client.from("audits").delete().eq("id", auditId).select("id");
        if (error) failed("audits.delete", error);
        return (data ?? []).length > 0;
      },
    };
  };
}
