/**
 * Environment validation is the first place a secret can leak. These tests care as much about
 * what an error message does not say as about what it does.
 */
import { describe, expect, it } from "vitest";

import { EnvError, SERVER_ONLY_ENV_KEYS, loadApiEnv, loadWebEnv, loadWorkerEnv } from "@siteaudit/config";

const production = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-value",
  REDIS_URL: "redis://localhost:6379",
};

describe("api environment", () => {
  it("fills development defaults so the app runs with no .env at all", () => {
    const env = loadApiEnv({});
    expect(env).toMatchObject({
      NODE_ENV: "development",
      PORT: 3000,
      LOG_LEVEL: "info",
      AUDIT_MAX_PAGES: 25,
      AUDIT_TIMEOUT_MS: 30_000,
      AUDIT_CONCURRENCY: 2,
    });
  });

  it("treats an empty string as unset, because .env.example ships empty values", () => {
    expect(loadApiEnv({ SUPABASE_URL: "", LLM_API_KEY: "   " })).toMatchObject({
      SUPABASE_URL: undefined,
      LLM_API_KEY: undefined,
    });
  });

  it("coerces numbers and rejects a port outside the range", () => {
    expect(loadApiEnv({ PORT: "8080" }).PORT).toBe(8080);
    expect(() => loadApiEnv({ PORT: "99999" })).toThrow(EnvError);
    expect(() => loadApiEnv({ PORT: "http" })).toThrow(EnvError);
  });

  it("bounds the audit limits so a typo cannot uncap a scan", () => {
    expect(() => loadApiEnv({ AUDIT_MAX_PAGES: "500" })).toThrow(EnvError);
    expect(() => loadApiEnv({ AUDIT_TIMEOUT_MS: "10" })).toThrow(EnvError);
    expect(() => loadApiEnv({ AUDIT_CONCURRENCY: "0" })).toThrow(EnvError);
  });

  it("requires the infrastructure in production, and names each missing variable", () => {
    expect(() => loadApiEnv({ NODE_ENV: "production" })).toThrow(EnvError);
    try {
      loadApiEnv({ NODE_ENV: "production" });
    } catch (error) {
      const variables = (error as EnvError).variables;
      expect(variables).toContain("SUPABASE_URL");
      expect(variables).toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(variables).toContain("REDIS_URL");
    }
  });

  it("accepts a complete production environment", () => {
    expect(loadApiEnv(production).NODE_ENV).toBe("production");
  });

  it("never puts a secret value in the error message", () => {
    try {
      loadApiEnv({ ...production, PORT: "not-a-port" });
      expect.unreachable("should have thrown");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).toContain("PORT");
      expect(message).not.toContain("service-role-secret-value");
      expect((error as EnvError).variables).toContain("PORT");
    }
  });
});

describe("worker environment", () => {
  it("validates without a PORT, because the worker does not listen", () => {
    expect(loadWorkerEnv({}).NODE_ENV).toBe("development");
    expect(() => loadWorkerEnv({ PORT: "3000" })).not.toThrow();
  });

  it("requires Redis in production", () => {
    try {
      loadWorkerEnv({ NODE_ENV: "production" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as EnvError).variables).toContain("REDIS_URL");
    }
  });
});

describe("web environment", () => {
  it("defaults the API base URL for local development", () => {
    expect(loadWebEnv({}).VITE_API_BASE_URL).toBe("http://localhost:3000/api/v1");
  });

  it("rejects a base URL that is not a URL", () => {
    expect(() => loadWebEnv({ VITE_API_BASE_URL: "the api" })).toThrow(EnvError);
  });

  it("refuses a document carrying a server-only key instead of stripping it", () => {
    for (const key of SERVER_ONLY_ENV_KEYS) {
      expect(() => loadWebEnv({ [key]: "leaked" }), key).toThrow(EnvError);
    }
  });

  it("drops VITE_ variables the app does not use", () => {
    const env = loadWebEnv({ VITE_API_BASE_URL: "https://api.example.com/v1", VITE_ANALYTICS_ID: "abc" });
    expect(Object.keys(env).sort()).toEqual(["VITE_API_BASE_URL"]);
  });

  it("keeps the server-only list free of anything the browser may read", () => {
    for (const key of SERVER_ONLY_ENV_KEYS) {
      expect(key.startsWith("VITE_"), key).toBe(false);
    }
    expect(SERVER_ONLY_ENV_KEYS).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(SERVER_ONLY_ENV_KEYS).toContain("LLM_API_KEY");
  });
});
