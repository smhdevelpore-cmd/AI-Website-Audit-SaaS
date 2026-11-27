/**
 * Audit submission, listing, polling and cancellation (TRD §5, §6).
 *
 * The shape of the write path matters more than the endpoint list:
 *
 *   1. Validate. Schema first, then the SSRF gate's syntax pass — a URL that cannot be audited
 *      never reaches the queue.
 *   2. Answer honestly about capacity. No queue configured, or a queue that refuses the job,
 *      produces an error, never a `queued` row that nothing will pick up.
 *   3. Create the row, then enqueue. If enqueueing fails, the row is deleted again: an audit
 *      labelled `queued` with no job behind it is a lie the UI would repeat for hours.
 *
 * Reads and deletes run with the caller's own token, so RLS decides visibility; the ownership
 * helper is a second gate and a log line, not the only one.
 */

import { Router } from "express";

import { AppError } from "@siteaudit/shared-types";
import type { AuditQueue } from "@siteaudit/queue";
import {
  UnsafeTargetError,
  clampMaxPages,
  createAuditInputSchema,
  listAuditsQuerySchema,
  parseTargetUrl,
  toPaginationMeta,
  type CreateAuditInput,
  type ListAuditsQuery,
} from "@siteaudit/validation";

import { currentData, currentUser, requireAuth, type AuthContext } from "../auth/middleware.js";
import { requireOwnedAudit } from "../data/audits.js";
import { toAuditView } from "../data/types.js";
import { validateBody, validateQuery } from "../http/validate.js";
import { USAGE_WINDOW_MS, type AuditLimits } from "../limits.js";

export interface AuditRouterDeps {
  /** `null` when this deployment has no Redis: submissions are refused rather than faked. */
  readonly queue: AuditQueue | null;
  readonly limits: AuditLimits;
  /** Injected in tests. */
  readonly now?: () => Date;
}

export function auditRouter(auth: AuthContext, deps: AuditRouterDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.post("/", requireAuth(auth), validateBody(createAuditInputSchema), async (request, response) => {
    const user = currentUser(request);
    const data = currentData(request);
    const input = request.body as CreateAuditInput;

    const queue = deps.queue;
    if (queue === null) {
      throw new AppError("service_unavailable", "Audits cannot be queued on this server.", {
        logContext: { reason: "queue_not_configured" },
      });
    }

    let url: URL;
    try {
      url = parseTargetUrl(input.url);
    } catch (error) {
      // The schema ran the same check, so reaching here means the two disagree: refuse anyway,
      // because the alternative is handing an unvetted address to the worker.
      throw new AppError("validation_failed", "Some values in the request are not valid.", {
        details: [
          {
            path: "url",
            reason: error instanceof UnsafeTargetError ? error.reason : "invalid_target",
            message: "That address cannot be audited.",
          },
        ],
      });
    }

    // The same address twice is a double click, not two audits. Returning the existing audit is
    // both cheaper and kinder than a 409 the client has to interpret.
    const existing = await data.findActiveAudit(user.id, url.href);
    if (existing !== null) {
      response.status(200).json({ success: true, data: toAuditView(existing), meta: { duplicate: true } });
      return;
    }

    const since = new Date(now().getTime() - USAGE_WINDOW_MS);
    const used = await data.countAuditsSince(user.id, since);
    if (used >= deps.limits.dailyLimit) {
      throw new AppError(
        "limit_exceeded",
        `You have started ${deps.limits.dailyLimit} audits in the last 24 hours, which is the limit for this account.`,
        {
          details: [{ path: "url", reason: "limit_exceeded", message: "Try again later." }],
          logContext: { userId: user.id, used, limit: deps.limits.dailyLimit },
        },
      );
    }

    // Server-side page cap: the client may ask for fewer pages, never more than either limit.
    const maxPages = Math.min(clampMaxPages(input.scanScope?.maxPages), deps.limits.maxPages);

    const row = await data.createAudit(user.id, {
      url: url.href,
      host: url.host,
      clientName: input.clientName ?? null,
      projectName: input.projectName ?? null,
      maxPages,
    });

    try {
      await queue.enqueue(row.id);
    } catch (error) {
      // Compensation. If the delete also fails the row stays behind, so it is logged with the
      // audit id: someone can clear it, and nothing claims the scan is running.
      let cleanedUp = false;
      try {
        cleanedUp = await data.deleteAudit(row.id);
      } catch (deleteError) {
        console.error("[api] orphaned queued audit", {
          auditId: row.id,
          userId: user.id,
          deleteError: deleteError instanceof Error ? deleteError.name : "unknown",
        });
      }
      console.error("[api] enqueue failed", {
        auditId: row.id,
        cleanedUp,
        error: error instanceof Error ? error.name : "unknown",
      });
      throw new AppError("service_unavailable", "The audit could not be queued. Nothing was started.", {
        logContext: { auditId: row.id, reason: "enqueue_failed", cleanedUp },
        cause: error,
      });
    }

    response
      .status(201)
      .location(`/api/v1/audits/${row.id}`)
      .json({ success: true, data: toAuditView(row), meta: { queued: true } });
  });

  router.get("/", requireAuth(auth), validateQuery(listAuditsQuerySchema), async (request, response) => {
    const user = currentUser(request);
    const data = currentData(request);
    const query = request.query as unknown as ListAuditsQuery;

    const result = await data.listAudits(user.id, {
      page: query.page,
      limit: query.limit,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.search === undefined ? {} : { search: query.search }),
    });

    response.json({
      success: true,
      data: result.rows.map(toAuditView),
      meta: toPaginationMeta(query.page, query.limit, result.total),
    });
  });

  router.get("/:id", requireAuth(auth), async (request, response) => {
    const user = currentUser(request);
    const id = request.params["id"];
    if (typeof id !== "string") {
      throw new AppError("not_found", "No audit with that id.");
    }
    const audit = await requireOwnedAudit(currentData(request), id, user.id);
    // A poll endpoint that is cached is a poll endpoint that lies about progress.
    response.setHeader("Cache-Control", "no-store");
    response.json({ success: true, data: toAuditView(audit) });
  });

  /**
   * Cancellation, and only where it is safe: a queued audit has a job that can be removed. A
   * running one is being worked on by a process this API cannot interrupt, so it is refused
   * with a reason instead of pretending the scan stopped.
   */
  router.delete("/:id", requireAuth(auth), async (request, response) => {
    const user = currentUser(request);
    const data = currentData(request);
    const id = request.params["id"];
    if (typeof id !== "string") {
      throw new AppError("not_found", "No audit with that id.");
    }

    const audit = await requireOwnedAudit(data, id, user.id);
    if (audit.status !== "queued") {
      throw new AppError(
        "audit_not_cancellable",
        "Only an audit that has not started yet can be cancelled.",
        { logContext: { auditId: audit.id, status: audit.status } },
      );
    }

    const queue = deps.queue;
    if (queue === null) {
      throw new AppError("service_unavailable", "Cancellation is not available on this server.", {
        logContext: { reason: "queue_not_configured" },
      });
    }

    const removed = await queue.cancel(audit.id);
    if (removed === "running") {
      throw new AppError(
        "audit_not_cancellable",
        "The scan has already started, so it cannot be cancelled.",
        { logContext: { auditId: audit.id, reason: "job_active" } },
      );
    }

    // `not-queued` means the job is already gone (finished, failed, or a worker died holding
    // it). Keeping a dead `queued` row would leave the UI waiting forever, so it is removed too.
    await data.deleteAudit(audit.id);
    response.status(204).end();
  });

  return router;
}
