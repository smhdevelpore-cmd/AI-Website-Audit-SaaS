/**
 * API process scaffold (Phase 0).
 *
 * One health endpoint and nothing else. Auth, audits, reports and queue dispatch are
 * product phases; adding a route here before its contract exists in docs/TRD.md is scope
 * creep, not setup.
 */
import express from "express";

const port = Number(process.env["PORT"] ?? 3000);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_request, response) => {
  response.json({ success: true, data: { status: "ok", version: 0 } });
});

app.use((_request, response) => {
  response.status(404).json({
    success: false,
    error: { code: "not_found", message: "No such route." },
  });
});

app.listen(port, () => {
  console.log(`[api] listening on ${port}`);
});
