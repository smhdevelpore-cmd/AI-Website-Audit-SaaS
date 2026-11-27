/**
 * The ownership helper (ARD §5: "API: validation, auth, ownership").
 *
 * Two gates, in this order:
 *   1. The database decides whether the row is visible at all (RLS, using the caller's token).
 *   2. This function refuses anything whose `user_id` is not the caller.
 *
 * A missing row and someone else's row produce the *same* answer, deliberately: if "not yours"
 * were distinguishable from "does not exist", the API would be an enumeration oracle.
 */

import { AppError } from "@siteaudit/shared-types";

import type { AuditRow, ProfileRow, UserData } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export async function requireOwnedAudit(data: UserData, auditId: string, userId: string): Promise<AuditRow> {
  // Ask PostgREST for a malformed uuid and it answers with a cast error, not an empty result.
  if (!isUuid(auditId)) {
    throw new AppError("not_found", "No audit with that id.");
  }

  const row = await data.findAudit(auditId);
  if (row === null) {
    throw new AppError("not_found", "No audit with that id.");
  }
  if (row.user_id !== userId) {
    // RLS should have hidden this row. Reaching here means a policy is wrong: refuse the
    // request, and make the event findable in logs.
    throw new AppError("not_found", "No audit with that id.", {
      logContext: { reason: "ownership_mismatch", auditId, userId },
    });
  }
  return row;
}

export async function requireOwnProfile(data: UserData, userId: string): Promise<ProfileRow> {
  const row = await data.findProfile(userId);
  if (row === null) {
    throw new AppError("not_found", "No profile yet.", {
      logContext: { reason: "profile_missing", userId },
    });
  }
  return row;
}
