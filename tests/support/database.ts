/**
 * A real Postgres for tests, without Docker.
 *
 * PGlite is PostgreSQL compiled to WebAssembly. The migrations in `supabase/migrations/` run
 * here **unmodified** — same files the Supabase CLI would apply — which is the point: a policy
 * that only works in a mock proves nothing about the database that will hold customer data.
 *
 * What this file adds, and nothing more, is the part of a Supabase project that lives outside
 * our migrations: the `anon` / `authenticated` / `service_role` roles, an `auth.users` table and
 * `auth.uid()`. They are defined exactly as Supabase defines them (see docs/SUPABASE.md), so
 * `auth.uid()` is driven by the same JWT claim the hosted service sets.
 *
 * Not covered by this harness, and therefore not claimed as tested anywhere: the Supabase Auth
 * HTTP endpoints (signup, login, refresh, reset mail), PostgREST's own parsing, and storage.
 */

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

/** Roles, schema and function that a Supabase project provides before migrations run. */
const SUPABASE_SHIM = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Supabase's own definition: the subject claim of the caller's JWT, as text, cast to uuid.
create function auth.uid() returns uuid
  language sql
  stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
`;

export interface TestDatabase {
  readonly db: PGlite;
  /** Apply every migration file in filename order. */
  migrate(): Promise<string[]>;
  close(): Promise<void>;
}

export async function migrationFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((name) => name.endsWith(".sql")).sort();
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_SHIM);

  return {
    db,
    async migrate() {
      const files = await migrationFiles();
      for (const file of files) {
        const sql = await readFile(MIGRATIONS_DIR + file, "utf8");
        try {
          await db.exec(sql);
        } catch (error) {
          throw new Error(`migration ${file} failed: ${(error as Error).message}`, { cause: error });
        }
      }
      return files;
    },
    close: () => db.close(),
  };
}

export type ActingRole = "authenticated" | "anon" | "service_role";

/**
 * Become a role for the next statements, the way PostgREST does per request.
 * `reset` goes back to the owning role.
 */
export async function actAs(db: PGlite, role: ActingRole, userId?: string): Promise<void> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
  if (role !== "service_role" && userId === undefined && role !== "anon") {
    throw new Error("acting as authenticated requires a user id");
  }
  if (role === "service_role") {
    await db.exec("set role service_role");
    return;
  }
  await db.exec(`set role ${role}`);
  if (userId !== undefined) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false) as ignored`, [userId]);
  }
}

/** Run a function as the table owner (migrations, fixtures) with RLS out of the way. */
export async function actAsOwner(db: PGlite): Promise<void> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
}

export interface SeedUser {
  id: string;
  email: string;
}

/** Insert an auth user the way a signup would, which must also create the profile. */
export async function seedUser(
  db: PGlite,
  email: string,
  metadata: Record<string, unknown> = {},
): Promise<SeedUser> {
  await actAsOwner(db);
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [email, JSON.stringify(metadata)],
  );
  const created = rows[0];
  if (created === undefined) throw new Error("auth user insert returned no row");
  return { id: created.id, email };
}

/** Create an audit owned by `userId`, bypassing RLS as the owner would. */
export async function seedAudit(db: PGlite, userId: string, url = "https://example.com"): Promise<string> {
  await actAsOwner(db);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.audits (user_id, url, host) values ($1, $2, $3) returning id`,
    [userId, url, new URL(url).host],
  );
  const created = rows[0];
  if (created === undefined) throw new Error("audit insert returned no row");
  return created.id;
}

/** True when the statement failed because of RLS or a missing privilege. */
export function isDenied(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  // 42501 insufficient_privilege means the grant or the policy said no; Postgres reports both
  // with the same code, so the message distinguishes them for debugging.
  return code === "42501";
}

export function isPermissionDenied(error: unknown): boolean {
  return isDenied(error) && /permission denied/i.test((error as Error).message);
}

export function isPolicyDenied(error: unknown): boolean {
  return isDenied(error) && /row-level security/i.test((error as Error).message);
}
