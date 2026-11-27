/**
 * The end of the line for every failure: one envelope, one code, no internals.
 */
import type { ErrorRequestHandler, RequestHandler } from "express";

import { AppError, toErrorBody, toSuccessBody } from "@siteaudit/shared-types";

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json(toErrorBody(new AppError("not_found", "No such route.")));
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    response.status(error.status).json(toErrorBody(error));
    return;
  }

  // A body parser rejects malformed or oversized JSON before any route runs.
  const type = (error as { type?: unknown }).type;
  if (type === "entity.too.large") {
    response
      .status(413)
      .json(toErrorBody(new AppError("payload_too_large", "That request body is too large.")));
    return;
  }
  if (type === "entity.parse.failed") {
    response
      .status(400)
      .json(toErrorBody(new AppError("validation_failed", "The request body is not valid JSON.")));
    return;
  }

  // Anything else is a bug. Log it with context; never send its message to a client.
  console.error("[api] unhandled error", {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : "unknown",
  });
  response.status(500).json(toErrorBody(new AppError("internal_error", "Something went wrong on our side.")));
};

export { toSuccessBody };
