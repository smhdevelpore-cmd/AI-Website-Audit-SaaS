/**
 * Reading one audit (TRD §5, `GET /audits/:id`).
 *
 * Read only, on purpose. Creating an audit enqueues a job, and there is no queue and no
 * crawler in this phase: an endpoint that returned `{status: "queued"}` for a row nothing will
 * ever pick up would be a lie told by the API. Creation arrives with the worker.
 */

import { Router } from "express";

import { AppError } from "@siteaudit/shared-types";

import { currentData, currentUser, requireAuth, type AuthContext } from "../auth/middleware.js";
import { requireOwnedAudit } from "../data/audits.js";
import { toAuditView } from "../data/types.js";

export function auditRouter(auth: AuthContext): Router {
  const router = Router();

  router.get("/:id", requireAuth(auth), async (request, response) => {
    const user = currentUser(request);
    const id = request.params["id"];
    if (typeof id !== "string") {
      throw new AppError("not_found", "No audit with that id.");
    }
    const audit = await requireOwnedAudit(currentData(request), id, user.id);
    response.json({ success: true, data: toAuditView(audit) });
  });

  return router;
}
