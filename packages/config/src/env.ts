/**
 * Environment configuration, one schema per process (TRD §4).
 *
 * Three rules this module exists to enforce:
 *  1. A server secret never enters the web schema. The web schema refuses a document that
 *     even contains a server-only key, rather than silently stripping it.
 *  2. An invalid environment fails at startup, naming the variable and never its value.
 *  3. Production requires what development may leave empty, and says so before serving.
 */

import { z } from "zod";

/**
 * Keys that must never appear in a browser bundle. Listed once, checked by the web schema
 * and asserted by tests, so a copy-paste from .env.example into a VITE_ variable is caught
 * here rather than in a public JavaScript file.
 */
export const SERVER_ONLY_ENV_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "PAGESPEED_API_KEY",
  "LLM_API_KEY",
  "LLM_MODEL",
  "REDIS_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_URL",
] as const;

const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");
const logLevelSchema = z.enum(["debug", "info", "warn", "error"]).default("info");

/** `.env.example` ships empty values; an empty string means "not set". */
const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.url().optional(),
);

const port = z.coerce.number().int().min(1).max(65535).default(3000);

const auditLimits = {
  AUDIT_MAX_PAGES: z.coerce.number().int().min(1).max(25).default(25),
  AUDIT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  AUDIT_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
};

const supabaseServer = {
  SUPABASE_URL: optionalUrl,
  SUPABASE_ANON_KEY: optionalText,
  SUPABASE_SERVICE_ROLE_KEY: optionalText,
};

export const apiEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    PORT: port,
    FRONTEND_ORIGIN: z.url().default("http://localhost:5173"),
    LOG_LEVEL: logLevelSchema,
    REDIS_URL: optionalUrl,
    PAGESPEED_API_KEY: optionalText,
    LLM_API_KEY: optionalText,
    LLM_MODEL: optionalText,
    CRAWLER_USER_AGENT: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .default("SiteAuditBot/0.1 (+https://example.com/bot)"),
    ...supabaseServer,
    ...auditLimits,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    for (const key of [
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "REDIS_URL",
    ] as const) {
      if (env[key] === undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: `${key} is required in production.` });
      }
    }
  });

export const workerEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: logLevelSchema,
    REDIS_URL: optionalUrl,
    PAGESPEED_API_KEY: optionalText,
    LLM_API_KEY: optionalText,
    LLM_MODEL: optionalText,
    CRAWLER_USER_AGENT: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .default("SiteAuditBot/0.1 (+https://example.com/bot)"),
    ...supabaseServer,
    ...auditLimits,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    for (const key of [
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "REDIS_URL",
    ] as const) {
      if (env[key] === undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: `${key} is required in production.` });
      }
    }
  });

/**
 * Browser configuration: `VITE_` variables only, and only the ones the app actually reads.
 * Everything here ends up in a public bundle.
 */
export const webEnvSchema = z.object({
  VITE_API_BASE_URL: z.url().default("http://localhost:3000/api/v1"),
  VITE_SUPABASE_URL: optionalUrl,
  VITE_SUPABASE_ANON_KEY: optionalText,
});

/**
 * Reads the server-only key names found in `source`.
 *
 * This runs on the raw input, not on parsed output: Zod drops unknown keys, so a schema-level
 * check would be looking at a document it had already cleaned. A secret in a browser config is
 * a build error, not something to quietly remove.
 */
export function findServerOnlyKeys(source: unknown): string[] {
  if (source === null || typeof source !== "object") return [];
  return SERVER_ONLY_ENV_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(source, key));
}

export class EnvError extends Error {
  /** Variable names only. Values may be secrets and never reach a log or a response. */
  readonly variables: readonly string[];

  constructor(scope: string, issues: ReadonlyArray<{ path: readonly PropertyKey[]; message: string }>) {
    const lines = issues.map(
      (issue) => `  ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`,
    );
    super(`Invalid ${scope} environment:\n${lines.join("\n")}`);
    this.name = "EnvError";
    this.variables = issues.map((issue) => issue.path.map(String).join(".")).filter((path) => path !== "");
  }
}

export function loadEnv<Schema extends z.ZodType>(
  schema: Schema,
  source: unknown,
  scope: string,
): z.output<Schema> {
  const result = schema.safeParse(source ?? {});
  if (!result.success) {
    throw new EnvError(scope, result.error.issues);
  }
  return result.data;
}

export const loadApiEnv = (source: unknown) => loadEnv(apiEnvSchema, source, "api");
export const loadWorkerEnv = (source: unknown) => loadEnv(workerEnvSchema, source, "worker");

export function loadWebEnv(source: unknown) {
  const leaked = findServerOnlyKeys(source);
  if (leaked.length > 0) {
    throw new EnvError(
      "web",
      leaked.map((key) => ({ path: [key], message: `${key} must not be present in browser config.` })),
    );
  }
  return loadEnv(webEnvSchema, source, "web");
}

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;
