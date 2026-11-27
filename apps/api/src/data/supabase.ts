/**
 * The Supabase implementation of `UserData`.
 *
 * One client per request, authorised with the **caller's** access token and the anon key. The
 * service-role key is deliberately absent from this file: nothing in a request path may run
 * with privileges that ignore RLS, or a missing filter becomes a cross-tenant read.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@siteaudit/shared-types";

import type { AuditRow, ProfilePatch, ProfileRow, UserData, UserDataFactory } from "./types.js";

const PROFILE_COLUMNS = "id,name,agency_name,website,timezone,logo_url,created_at,updated_at";
const AUDIT_COLUMNS =
  "id,user_id,url,host,status,stage,max_pages,pages_scanned,was_partial,scoring_version," +
  "error_code,error_message,started_at,completed_at,created_at,updated_at";

function failed(operation: string, error: { message: string; code?: string } | null): never {
  // The PostgREST message can contain column names; it is for logs, not for the client.
  throw new AppError("internal_error", "We could not reach the database.", {
    logContext: { operation, databaseCode: error?.code, databaseMessage: error?.message },
    cause: error,
  });
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
    };
  };
}
