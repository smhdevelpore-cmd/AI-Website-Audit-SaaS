/**
 * API process (Phase 1: contracts only).
 *
 * Routes here are infrastructure — health and the error envelope. Audit routes arrive when
 * the crawler and the queue they depend on exist, so this file cannot advertise an endpoint
 * that would have to invent data.
 */
import express from "express";

import { toSuccessBody } from "@siteaudit/shared-types";
import { createAuditInputSchema } from "@siteaudit/validation";

import { loadConfig } from "./config.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import { validateBody } from "./http/validate.js";

const config = loadConfig();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_request, response) => {
  response.json(toSuccessBody({ status: "ok", version: 1 }));
});

/**
 * Contract probe: validates the documented create request and echoes back only what the
 * contract accepted. It does not create an audit, queue anything or touch the network —
 * wiring it to a real job is Phase 4.
 */
app.post("/api/v1/audits/validate", validateBody(createAuditInputSchema), (request, response) => {
  response.json(toSuccessBody({ accepted: request.body, queued: false }));
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`[api] listening on ${config.PORT} (${config.NODE_ENV})`);
});
