/**
 * The Express application, assembled from injected dependencies so it can be exercised without
 * a network, a database or a live Supabase project.
 *
 * `index.ts` supplies the real ones; tests supply fakes that implement the same interfaces.
 */

import express, { type Express, type RequestHandler } from "express";

import { AppError, toSuccessBody } from "@siteaudit/shared-types";
import { createAuditInputSchema } from "@siteaudit/validation";

import { currentUser, requireAuth, type AuthContext } from "./auth/middleware.js";
import { auditRouter } from "./routes/audits.js";
import { profileRouter } from "./routes/profile.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import { validateBody } from "./http/validate.js";

export interface AppOptions {
  /**
   * `null` when the environment has no Supabase URL, anon key or token key. The API still
   * serves health and the contract probe, and answers auth-protected routes with 503 instead
   * of pretending a token was checked.
   */
  readonly auth: AuthContext | null;
}

const authUnavailable: RequestHandler = (_request, _response, next) => {
  next(
    new AppError("service_unavailable", "Sign-in is not configured on this server.", {
      logContext: { reason: "auth_not_configured" },
    }),
  );
};

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_request, response) => {
    response.json(
      toSuccessBody({ status: "ok", version: 1, auth: options.auth === null ? "absent" : "ready" }),
    );
  });

  /**
   * Contract probe: validates the documented create request and echoes back only what the
   * contract accepted. It does not create an audit, queue anything or touch the network.
   */
  app.post("/api/v1/audits/validate", validateBody(createAuditInputSchema), (request, response) => {
    response.json(toSuccessBody({ accepted: request.body, queued: false }));
  });

  if (options.auth === null) {
    // Registered after the probe above, so `POST /audits/validate` still answers.
    app.use("/api/v1/me", authUnavailable);
    app.use("/api/v1/profile", authUnavailable);
    app.use("/api/v1/audits", authUnavailable);
  } else {
    const auth = options.auth;

    app.get("/api/v1/me", requireAuth(auth), (request, response) => {
      const user = currentUser(request);
      response.json(toSuccessBody({ id: user.id, email: user.email }));
    });

    app.use("/api/v1/profile", profileRouter(auth));
    app.use("/api/v1/audits", auditRouter(auth));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
