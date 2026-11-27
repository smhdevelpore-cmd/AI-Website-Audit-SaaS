# Submitting an audit: API, queue and worker (Phase 4)

An audit is a long job, so the HTTP request that starts one does three things and returns:
validate, persist a `queued` row, enqueue a job. Everything after that happens in the worker.

```
POST /audits ──► validate (schema + SSRF syntax gate)
             ──► usage limit, duplicate check
             ──► insert audits row (status = queued)      ← caller's own token, RLS allows it
             ──► queue.add(jobId = audit id)              ← BullMQ / Redis
             ──► 201 {status: "queued"} + Location
                       │
                       ▼
             worker picks it up ──► queued → running (stage: validating)
                                 ──► record usage
                                 ──► validate target again (DNS + IP)
                                 ──► crawl → rules → score (each its own stage)
                                 ──► failed / completed / partial + completed_at
```

## 1. Endpoints

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/api/v1/audits` | `201` when a new audit is queued; `200` with `meta.duplicate: true` when the same address is already queued or running; `429 limit_exceeded`; `503 service_unavailable` when there is no queue or the queue refused the job |
| `GET` | `/api/v1/audits?page&limit&status&search` | `data: Audit[]`, `meta: {page, limit, total, totalPages, hasMore}` |
| `GET` | `/api/v1/audits/:id` | the audit, `Cache-Control: no-store` (it is a poll target) |
| `DELETE` | `/api/v1/audits/:id` | `204` for a queued audit whose job was removed; `409 audit_not_cancellable` once it has started |
| `GET` | `/health` | `{status, version, checks: {auth, queue}}`; `503` only when a *configured* queue is unreachable |

`POST /api/v1/audits/validate` still exists as the contract probe: it validates and echoes,
queues nothing.

## 2. Server-side limits

| Limit | Source | Effect |
|---|---|---|
| `AUDIT_MAX_PAGES` | env (1–25) | the row's `max_pages` is `min(client request, env, 25)` |
| `AUDIT_DAILY_LIMIT` | env (default 20) | rolling 24-hour count per user → `429 limit_exceeded` |
| request body | 100 kB JSON limit | `413 payload_too_large` |

The client may ask for fewer pages. It cannot ask for more: `clampMaxPages` runs on the server
even though Zod already checked the shape.

## 3. The job contract

One job per audit, and the job's id **is** the audit id:

```jsonc
// queue: "siteaudit.audit"   job name: "scan"
{ "auditId": "9f2b...-..." }
```

- `attempts: 3`, `backoff: exponential, 2 s` → retries at ~2 s and ~4 s.
- `removeOnComplete: { age: 3600, count: 1000 }`, `removeOnFail: { age: 86400 }`.
- The payload is `z.object({auditId}).strict()`: a job carrying anything else is rejected as
  unreadable and is **not** retried.

Because the job id is the audit id, `add` twice is one job. The adapter still checks first, so
the API can answer 200 instead of a second 201.

## 4. Retry classification

The runner decides before BullMQ does, because "retry everything" turns a broken site into a
flaky-looking server and a bug into three identical failures.

| Situation | Outcome |
|---|---|
| Audit row missing | skipped — nothing to do, no retry |
| Audit already terminal | skipped — a retried job must not reopen a finished audit |
| Row no longer queued/running (cancelled, deleted) | skipped — `markRunning` is conditional in SQL |
| Target is a private address / internal hostname / bad scheme | **failed** `target_not_allowed`, no retry |
| DNS lookup failed | retry; on the last attempt **failed** `target_unreachable` |
| Database read/write failed | retry; on the last attempt **failed** `internal_error` |
| A pipeline step threw | retry; on the last attempt **failed** `internal_error` |
| Total budget (`AUDIT_TIMEOUT_MS`) exceeded | retry; on the last attempt **failed** `internal_error` |
| Pipeline ended without a verdict | **failed** `internal_error` (a wiring bug, not a scan result) |

Every stored message is generated from the code (`publicAuditFailureMessage`). No exception text
reaches the row: it can contain a hostname, an IP or a connection string.

## 5. Idempotency and consistency

- **Enqueue is idempotent** by job id.
- **Status writes are conditional**, in SQL rather than in a preceding read:
  `markRunning` requires `status in (queued, running)`; `finish` additionally requires
  `completed_at is null`. A retried job, a worker restart and a cancel racing a pickup all end
  in a defined state.
- **`started_at` survives a retry**: a job that is already `running` keeps its original start
  time instead of restarting the clock.
- **If enqueue fails, the row is deleted.** The API creates the row, then enqueues; when the
  queue refuses (dead Redis, timeout at 2 s), the row is removed and the response is `503`, so
  nothing is ever labelled `queued` without a job behind it. If the compensating delete also
  fails, the audit id is logged for cleanup.
- **A job can still arrive after a failed enqueue.** ioredis buffers commands while reconnecting,
  so a `503` does not guarantee Redis never saw the job. The worker handles that: it loads the
  audit, finds nothing, and skips. This is why the runner starts with a read rather than trusting
  the payload.

## 6. Cancellation

Only a `queued` audit can be cancelled, and the request path checks in this order:

1. Row status must be `queued` → otherwise `409 audit_not_cancellable`.
2. `queue.cancel(auditId)` → `removed` | `running` | `not-queued`.
3. `running` → `409` and nothing is deleted (the worker holds the job).
4. `removed` / `not-queued` → the row is deleted → `204`.

`not-queued` still deletes the row: the job is already gone (finished, failed, or a worker died
holding it), and leaving a `queued` row that nothing will ever finish would keep the UI waiting
forever.

There is a small window between the queue removing a job and a worker claiming it. It is closed
on the other side by `markRunning`: a worker that claims an audit whose row has been deleted gets
`false` back and stops.

## 7. Health

`GET /health` reports `checks.queue`:

- `ok` — a real round trip to Redis succeeded (`getJobCounts` under a 1 s budget).
- `unavailable` — configured but unreachable → HTTP **503**, so a load balancer stops sending
  submissions here.
- `absent` — no `REDIS_URL`: the API still serves reads and profile, and submissions answer 503.

Verified in this environment: with `REDIS_URL` pointing at a closed port, `/health` answers
`503` in about one second and the process stays up.

## 8. What the worker does today

Three steps, in the TRD's order (`apps/worker/src/scan-steps.ts`):

`queued → running (validating) → crawling → rules → scoring → completed | partial`

- **crawling** — a bounded crawl of the audit's URL (robots.txt, sitemap, links, page and depth
  caps), storing each page as an `audit_pages` row. If the start page cannot be read the audit
  fails `target_unreachable` immediately: that is the site's answer, not a transient failure, and
  retrying it three times would only delay the truth.
- **rules** — the deterministic rules (`@siteaudit/audit-rules`) over the crawl. Findings are
  written per audit and per page; see [`RULES.md`](RULES.md).
- **scoring** — the weighted score, stored with `scoring_version` before the audit finishes, so a
  `completed` row can never exist without the number and the formula that produced them.

A page that failed to fetch (a timeout, a PDF served at a page URL) makes the audit **partial**:
the results cover what was read. A site that answered nothing is **failed**. Neither case invents
a result, and a failed audit carries no score at all.

Not yet in the pipeline: the PageSpeed provider and the AI explanation (Phase 7). Their stages
already exist in the schema, so they slot in between `rules` and `scoring` without a migration.

## 9. Running it

```bash
docker compose up -d redis        # Redis on 6379
npm run build
node apps/api/dist/index.js       # needs SUPABASE_* and REDIS_URL to accept submissions
node apps/worker/dist/index.js    # refuses to start without REDIS_URL and the service role key
```

The worker exits 1 with a one-line reason if `REDIS_URL`, `SUPABASE_URL` or
`SUPABASE_SERVICE_ROLE_KEY` is missing. A worker that cannot work should not look alive.

## 10. What is not proven here

**No Redis exists in this environment and Docker is unavailable.** So:

- Every API test runs against `MemoryAuditQueue`, which implements the same contract and the
  same rules (idempotent enqueue, `running` cancellation refusal, health).
- The BullMQ adapter is typechecked and its connection parsing is unit-tested, but its Redis
  behaviour is **not** claimed as tested. `tests/integration/queue-bullmq.test.ts` runs only when
  `REDIS_TEST_URL` is set (`REDIS_TEST_URL=redis://localhost:6379/15 npm run test`), and reports
  as skipped otherwise — two skipped tests in the current suite are exactly this.
- Also unproven: a real Supabase project receiving the `insert`/`update` statements, and the
  PostgREST `or=` search filter (the term is sanitised and the behaviour is covered against the
  in-memory store, not against PostgREST's parser).

## 11. Usage metering

`usage_records` is written by the **worker** (service role), not the API: `authenticated` has no
insert grant on that table, and the request path deliberately holds no privileged key. The
`audit` quantity is recorded when a job claims the audit; `page`, `provider_call`, `ai_token` and
`report` arrive with the modules that spend them.

The daily limit therefore counts rows in `audits` — a table the caller can already read — rather
than the meter. The two cannot drift into disagreeing about whether a limit was hit.
