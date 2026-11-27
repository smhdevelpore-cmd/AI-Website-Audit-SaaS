/**
 * The worker runner, without Redis.
 *
 * `runAuditJob` is the part of the worker that decides what an audit becomes. Testing it
 * directly is the only way to prove the interesting cases — a retried job that must not reopen a
 * finished audit, a cancelled audit that must not be scanned, a private address that must not be
 * retried into existence — without waiting on a real queue's backoff.
 */

import { UnsafeTargetError, type SafeTarget } from "@siteaudit/validation";
import { beforeEach, describe, expect, it } from "vitest";

import type { WorkerData } from "../../apps/worker/src/data.js";
import type { ScanStep } from "../../apps/worker/src/pipeline.js";
import { runAuditJob, type RunAuditDeps } from "../../apps/worker/src/run-audit.js";
import { InMemoryUserData } from "../support/audit-store.js";
import { ALICE } from "../support/tokens.js";
import { InMemoryWorkerData } from "../support/worker-data.js";

const AUDIT_ID = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";

let store: InMemoryUserData;
let data: InMemoryWorkerData;

function deps(overrides: Partial<RunAuditDeps> = {}): RunAuditDeps {
  return {
    data,
    resolveTarget: async (url): Promise<SafeTarget> => ({
      url: new URL(url),
      addresses: [{ address: "93.184.216.34", family: 4 }],
    }),
    steps: [],
    timeoutMs: 1_000,
    maxAttempts: 3,
    ...overrides,
  };
}

const row = () => {
  const found = store.audits.get(AUDIT_ID);
  if (found === undefined) throw new Error("the audit vanished");
  return found;
};

beforeEach(() => {
  store = new InMemoryUserData(() => new Date("2026-11-27T12:00:00.000Z"));
  store.addProfile(ALICE);
  store.seedAudit({ id: AUDIT_ID, userId: ALICE, url: "https://example.com" });
  data = new InMemoryWorkerData(store);
});

describe("runAuditJob", () => {
  it("claims the audit, records usage and reports that this build cannot scan", async () => {
    const result = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());

    expect(result).toEqual({ outcome: "done", status: "failed" });
    expect(row()).toMatchObject({
      status: "failed",
      stage: "validating",
      error_code: "scanner_not_ready",
      error_message: "This build cannot scan websites yet. Nothing was measured and no report was produced.",
    });
    expect(row().started_at).not.toBeNull();
    expect(row().completed_at).not.toBeNull();
    expect(data.usage).toEqual([{ userId: ALICE, auditId: AUDIT_ID, kind: "audit", quantity: 1 }]);
  });

  it("does nothing for an audit that no longer exists", async () => {
    const result = await runAuditJob({ auditId: "11111111-1111-4111-8111-111111111111", attempt: 1 }, deps());
    expect(result).toEqual({ outcome: "skipped", reason: "missing" });
    expect(data.usage).toHaveLength(0);
  });

  it("will not reopen an audit that has already finished", async () => {
    store.seedAudit({ id: AUDIT_ID, userId: ALICE, url: "https://example.com", status: "completed" });

    const result = await runAuditJob({ auditId: AUDIT_ID, attempt: 2 }, deps());

    expect(result).toEqual({ outcome: "skipped", reason: "already-finished" });
    expect(row().status).toBe("completed");
    expect(data.refused).toHaveLength(0);
  });

  it("skips an audit cancelled between enqueueing and pickup", async () => {
    // Spreading a class instance would lose its methods; the passthrough is explicit.
    const refusing: WorkerData = {
      loadAudit: async () => ({
        id: AUDIT_ID,
        user_id: ALICE,
        url: "https://example.com",
        host: "example.com",
        status: "queued",
        stage: null,
        max_pages: 25,
        started_at: null,
      }),
      markRunning: async () => false,
      setStage: (id, stage) => data.setStage(id, stage),
      finish: (id, finish) => data.finish(id, finish),
      recordUsage: (record) => data.recordUsage(record),
    };

    const result = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps({ data: refusing }));

    expect(result).toEqual({ outcome: "skipped", reason: "not-queued" });
    expect(data.usage).toHaveLength(0);
  });

  it("fails, and does not retry, an audit whose stored target is private", async () => {
    const result = await runAuditJob(
      { auditId: AUDIT_ID, attempt: 1 },
      deps({
        resolveTarget: async () => {
          throw new UnsafeTargetError("address-not-public", "literal address is not public");
        },
      }),
    );

    expect(result).toEqual({ outcome: "done", status: "failed" });
    expect(row()).toMatchObject({ status: "failed", error_code: "target_not_allowed" });
    // The sentence is ours; the reason string from the gate never reaches the row.
    expect(row().error_message).toBe("That address is not a public website this service is allowed to scan.");
  });

  it("retries a DNS failure, then gives up with target_unreachable", async () => {
    const dnsFailure = () =>
      deps({
        resolveTarget: async () => {
          throw new UnsafeTargetError("dns-failed", "lookup failed");
        },
      });

    const first = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, dnsFailure());
    expect(first.outcome).toBe("retry");
    expect(row().status).toBe("running");
    expect(row().completed_at).toBeNull();

    const last = await runAuditJob({ auditId: AUDIT_ID, attempt: 3 }, dnsFailure());
    expect(last).toEqual({ outcome: "done", status: "failed" });
    expect(row()).toMatchObject({ status: "failed", error_code: "target_unreachable" });
  });

  it("treats a database failure as retryable and leaves the audit running", async () => {
    data.failNextLoad = true;
    const first = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());

    expect(first.outcome).toBe("retry");
    expect(row().status).toBe("queued");

    const second = await runAuditJob({ auditId: AUDIT_ID, attempt: 2 }, deps());
    expect(second).toEqual({ outcome: "done", status: "failed" });
  });

  it("fails after the last attempt instead of retrying forever", async () => {
    data.failNextLoad = true;
    const result = await runAuditJob({ auditId: AUDIT_ID, attempt: 3 }, deps());

    expect(result).toEqual({ outcome: "done", status: "failed" });
    expect(row()).toMatchObject({ status: "failed", error_code: "internal_error" });
  });

  it("runs the steps it is given, reports their stage and finishes with their verdict", async () => {
    const seen: string[] = [];
    const steps: ScanStep[] = [
      {
        stage: "crawling",
        run: async () => {
          seen.push("crawling");
          return "continue";
        },
      },
      {
        stage: "scoring",
        run: async () => {
          seen.push("scoring");
          return { status: "partial", pagesScanned: 4 };
        },
      },
      {
        stage: "ai",
        run: async () => {
          seen.push("ai");
          return "continue";
        },
      },
    ];

    const result = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps({ steps }));

    expect(result).toEqual({ outcome: "done", status: "partial" });
    // `ai` never ran: a step that finishes the audit ends the pipeline.
    expect(seen).toEqual(["crawling", "scoring"]);
    expect(data.stages.map((entry) => entry.stage)).toEqual(["crawling", "scoring"]);
    expect(row()).toMatchObject({ status: "partial", pages_scanned: 4, was_partial: true });
  });

  it("fails an audit whose pipeline ends without a verdict", async () => {
    const steps: ScanStep[] = [{ stage: "crawling", run: async () => "continue" }];
    const result = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps({ steps }));

    expect(result).toEqual({ outcome: "done", status: "failed" });
    expect(row()).toMatchObject({ status: "failed", error_code: "internal_error" });
  });

  it("retries a step that fails, then reports the failure", async () => {
    const failing: ScanStep[] = [
      {
        stage: "crawling",
        run: async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.7:443");
        },
      },
    ];

    const first = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps({ steps: failing }));
    expect(first.outcome).toBe("retry");

    const last = await runAuditJob({ auditId: AUDIT_ID, attempt: 3 }, deps({ steps: failing }));
    expect(last).toEqual({ outcome: "done", status: "failed" });
    // The step's own message is not stored: it names an internal address.
    expect(row().error_code).toBe("internal_error");
    expect(row().error_message).not.toContain("10.0.0.7");
  });

  it("enforces a total time budget even when a step ignores it", async () => {
    const slow: ScanStep[] = [{ stage: "crawling", run: () => new Promise<"continue">(() => undefined) }];

    const result = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps({ steps: slow, timeoutMs: 20 }));

    expect(result.outcome).toBe("retry");
    const final = await runAuditJob({ auditId: AUDIT_ID, attempt: 3 }, deps({ steps: slow, timeoutMs: 20 }));
    expect(final).toEqual({ outcome: "done", status: "failed" });
    expect(row().error_code).toBe("internal_error");
  });

  it("is idempotent: a second run of a finished audit changes nothing", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());
    const firstRun = row();
    const second = await runAuditJob({ auditId: AUDIT_ID, attempt: 2 }, deps());

    expect(second).toEqual({ outcome: "skipped", reason: "already-finished" });
    expect(row()).toEqual(firstRun);
    // It stopped at the first read: no second claim, no second usage record, no second write.
    expect(data.usage).toHaveLength(1);
    expect(data.stages).toHaveLength(0);
  });
});
