/**
 * Worker process (Phase 1: configuration only).
 *
 * It validates its environment the same way the API does, then says there is no queue and
 * exits 0. A process that idles while pretending to consume work is worse than one that
 * says plainly it has nothing to do.
 */
import { loadConfig } from "./config.js";

const config = loadConfig();

console.log(
  `[worker] scaffold only: env valid (${config.NODE_ENV}), no queue configured, nothing to consume.`,
);
process.exitCode = 0;
