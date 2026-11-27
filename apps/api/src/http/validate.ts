/**
 * Request validation middleware (Phase 1). One place where a request body, query or params
 * becomes a typed value — or a 400 with a stable code and field paths.
 */
import type { RequestHandler } from "express";
import type { z } from "zod";

import { AppError, type ErrorDetail } from "@siteaudit/shared-types";

export type RequestPart = "body" | "query" | "params";

export interface ZodIssueLike {
  path: readonly PropertyKey[];
  code: string;
  message: string;
}

export function toErrorDetails(issues: ReadonlyArray<ZodIssueLike>): ErrorDetail[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    reason: issue.code,
    message: issue.message,
  }));
}

/**
 * Replaces the request part with the schema output, so a handler only ever reads validated
 * data and unknown keys are dropped. Express 5 defines `req.query` as a getter, so the value
 * is defined rather than assigned; that path works for every part.
 */
export function validate(part: RequestPart, schema: z.ZodType): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request[part]);
    if (!result.success) {
      next(
        new AppError("validation_failed", "Some values in the request are not valid.", {
          details: toErrorDetails(result.error.issues),
        }),
      );
      return;
    }

    Object.defineProperty(request, part, {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}

export const validateBody = (schema: z.ZodType): RequestHandler => validate("body", schema);
export const validateQuery = (schema: z.ZodType): RequestHandler => validate("query", schema);
export const validateParams = (schema: z.ZodType): RequestHandler => validate("params", schema);
