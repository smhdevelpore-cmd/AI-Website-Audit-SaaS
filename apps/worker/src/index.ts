/**
 * Worker process scaffold (Phase 0).
 *
 * BullMQ and Redis arrive with the audit pipeline. Until a queue exists there is nothing
 * to consume, so this process says so and exits 0 rather than idling and pretending to
 * work.
 */
const main = (): void => {
  console.log("[worker] scaffold only: no queue configured, nothing to consume.");
  process.exitCode = 0;
};

main();
