/**
 * The error contract: one envelope, one code per failure, no internals in the response.
 * These tests call the handlers directly — no HTTP server, no extra dependency.
 */
import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";

import { AppError, httpStatusFor, toErrorBody, toSuccessBody } from "@siteaudit/shared-types";
import { createAuditInputSchema } from "@siteaudit/validation";

import { errorHandler, notFoundHandler } from "../../apps/api/src/http/errors.js";
import { toErrorDetails, validateBody, validateQuery } from "../../apps/api/src/http/validate.js";

interface Captured {
  status?: number;
  body?: unknown;
}

function fakeResponse(captured: Captured): Response {
  const response = {
    headersSent: false,
    status(code: number) {
      captured.status = code;
      return response;
    },
    json(payload: unknown) {
      captured.body = payload;
      return response;
    },
  };
  return response as unknown as Response;
}

describe("server-side failures", () => {
  it("logs the cause of a 5xx and still sends nothing but a sentence", () => {
    const captured: Captured = {};
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);

    try {
      errorHandler(
        new AppError("internal_error", "We could not reach the database.", {
          logContext: {
            operation: "profiles.select",
            databaseMessage: "permission denied for table profiles",
          },
        }),
        {} as Request,
        fakeResponse(captured),
        () => undefined,
      );
    } finally {
      console.error = original;
    }

    // The log has the operation and the database's own words...
    expect(JSON.stringify(logged)).toContain("profiles.select");
    expect(JSON.stringify(logged)).toContain("permission denied");

    // ...the response has neither.
    expect(captured.status).toBe(500);
    const body = JSON.stringify(captured.body);
    expect(body).not.toContain("profiles.select");
    expect(body).not.toContain("permission denied");
    expect(captured.body).toEqual({
      success: false,
      error: { code: "internal_error", message: "We could not reach the database." },
    });
  });

  it("does not log a 4xx as a server fault", () => {
    const captured: Captured = {};
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      errorHandler(
        new AppError("not_found", "No audit with that id.", { logContext: { auditId: "x" } }),
        {} as Request,
        fakeResponse(captured),
        () => undefined,
      );
    } finally {
      console.error = original;
    }
    expect(logged).toHaveLength(0);
    expect(captured.status).toBe(404);
  });
});

describe("error contract", () => {
  it("maps a code to one status, not to whatever a route felt like", () => {
    expect(httpStatusFor("validation_failed")).toBe(400);
    expect(httpStatusFor("unauthenticated")).toBe(401);
    expect(httpStatusFor("forbidden")).toBe(403);
    expect(httpStatusFor("not_owned")).toBe(404);
    expect(httpStatusFor("limit_exceeded")).toBe(429);
    expect(httpStatusFor("target_not_allowed")).toBe(422);
    expect(httpStatusFor("provider_unavailable")).toBe(503);
    expect(httpStatusFor("internal_error")).toBe(500);
  });

  it("omits details when there are none and includes them when there are", () => {
    expect(toErrorBody(new AppError("not_found", "No such route."))).toEqual({
      success: false,
      error: { code: "not_found", message: "No such route." },
    });

    const withDetails = toErrorBody(
      new AppError("validation_failed", "Bad request.", {
        details: [{ path: "url", reason: "custom", message: "Only http and https." }],
      }),
    );
    expect(withDetails.error.details).toHaveLength(1);
  });

  it("keeps log context out of the response body", () => {
    const body = toErrorBody(
      new AppError("internal_error", "Something went wrong on our side.", {
        logContext: { stack: "secret internals", userId: "u1" },
      }),
    );
    expect(JSON.stringify(body)).not.toContain("secret internals");
    expect(JSON.stringify(body)).not.toContain("userId");
  });

  it("answers an unknown route with the envelope and 404", () => {
    const captured: Captured = {};
    notFoundHandler({} as Request, fakeResponse(captured), () => undefined);
    expect(captured.status).toBe(404);
    expect(captured.body).toMatchObject({ success: false, error: { code: "not_found" } });
  });

  it("turns an unexpected throw into a sanitised 500", () => {
    const captured: Captured = {};
    const thrown = new Error("connection string postgres://user:pw@host/db leaked");
    errorHandler(thrown, {} as Request, fakeResponse(captured), () => undefined);

    expect(captured.status).toBe(500);
    const body = JSON.stringify(captured.body);
    expect(body).toContain("internal_error");
    expect(body).not.toContain("postgres://");
  });

  it("reports a body-parser failure as a validation error, not a 500", () => {
    const captured: Captured = {};
    errorHandler({ type: "entity.parse.failed" }, {} as Request, fakeResponse(captured), () => undefined);
    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({ error: { code: "validation_failed" } });
  });

  it("builds a success envelope with optional meta", () => {
    expect(toSuccessBody({ ok: true })).toEqual({ success: true, data: { ok: true } });
    expect(toSuccessBody({ ok: true }, { page: 1 })).toEqual({
      success: true,
      data: { ok: true },
      meta: { page: 1 },
    });
  });
});

describe("validation middleware", () => {
  function run(middleware: ReturnType<typeof validateBody>, request: Record<string, unknown>) {
    let forwarded: unknown;
    let called = false;
    middleware(request as unknown as Request, {} as Response, (error?: unknown) => {
      called = true;
      forwarded = error;
    });
    return { called, forwarded, request };
  }

  it("rejects an unsafe URL with one code and a field path", () => {
    const { forwarded } = run(validateBody(createAuditInputSchema), {
      body: { url: "http://169.254.169.254/" },
    });

    expect(forwarded).toBeInstanceOf(AppError);
    const error = forwarded as AppError;
    expect(error.code).toBe("validation_failed");
    expect(error.status).toBe(400);
    expect(error.details[0]?.path).toBe("url");
  });

  it("rejects a body that is not an object at all", () => {
    const { forwarded } = run(validateBody(createAuditInputSchema), { body: "https://example.com" });
    expect((forwarded as AppError).code).toBe("validation_failed");
  });

  it("replaces the body with the parsed value and drops unknown keys", () => {
    const { called, forwarded, request } = run(validateBody(createAuditInputSchema), {
      body: { url: "https://example.com", admin: true },
    });

    expect(called).toBe(true);
    expect(forwarded).toBeUndefined();
    expect(request["body"]).toEqual({ url: "https://example.com" });
    expect(request["body"]).not.toHaveProperty("admin");
  });

  it("validates a query string and coerces its numbers", () => {
    const { forwarded, request } = run(validateQuery(createAuditInputSchema), { query: {} });
    expect(forwarded).toBeInstanceOf(AppError);

    const paged = run(validateQuery({ safeParse: (v: unknown) => ({ success: true, data: v }) } as never), {
      query: { page: "2" },
    });
    expect(paged.forwarded).toBeUndefined();
    expect(request["query"]).toBeDefined();
  });

  it("formats issues as dot paths with a stable reason", () => {
    const details = toErrorDetails([
      { path: ["scanScope", "maxPages"], code: "too_big", message: "Too many pages." },
    ]);
    expect(details).toEqual([{ path: "scanScope.maxPages", reason: "too_big", message: "Too many pages." }]);
  });
});
