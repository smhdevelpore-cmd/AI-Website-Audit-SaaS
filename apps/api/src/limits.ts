/**
 * The limits this deployment enforces, read from the environment (TRD §14, PRD FR-17).
 *
 * They exist here rather than inline in a route so that a test can lower them and so that the
 * sentence a user sees ("25 audits in the last 24 hours") is generated from the number that is
 * actually enforced.
 */

export interface AuditLimits {
  /** Ceiling for one audit's page count, whatever the client asks for. */
  readonly maxPages: number;
  /** Audits one account may start inside the usage window. */
  readonly dailyLimit: number;
}

/** One day. A rolling window, not a calendar day — nobody's evening should reset at midnight UTC. */
export const USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_AUDIT_LIMITS: AuditLimits = { maxPages: 25, dailyLimit: 20 };
