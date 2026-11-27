/**
 * `GET /profile` and `PATCH /profile` (TRD §5).
 *
 * The user id comes from the verified token, never from the body or the query string. A client
 * that sends someone else's id is not corrected — there is no field in which it could send one.
 */

import { Router } from "express";

import { AppError } from "@siteaudit/shared-types";
import { updateProfileSchema } from "@siteaudit/validation";

import { currentData, currentUser, requireAuth, type AuthContext } from "../auth/middleware.js";
import { requireOwnProfile } from "../data/audits.js";
import { toProfileView, type ProfilePatch } from "../data/types.js";
import { validateBody } from "../http/validate.js";

function toPatch(input: ReturnType<typeof updateProfileSchema.parse>): ProfilePatch {
  const patch: ProfilePatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.agencyName !== undefined) patch.agency_name = input.agencyName;
  if (input.website !== undefined) patch.website = input.website;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.logoUrl !== undefined) patch.logo_url = input.logoUrl;
  return patch;
}

export function profileRouter(auth: AuthContext): Router {
  const router = Router();

  router.get("/", requireAuth(auth), async (request, response) => {
    const user = currentUser(request);
    const profile = await requireOwnProfile(currentData(request), user.id);
    response.json({ success: true, data: toProfileView(profile) });
  });

  router.patch("/", requireAuth(auth), validateBody(updateProfileSchema), async (request, response) => {
    const user = currentUser(request);
    const data = currentData(request);
    const patch = toPatch(request.body as ReturnType<typeof updateProfileSchema.parse>);

    // `updateProfileSchema` requires `name`, so a patch always has at least one column; an
    // empty object would be a no-op update that still touches `updated_at`.
    const updated = await data.updateProfile(user.id, patch);
    if (updated === null) {
      throw new AppError("not_found", "No profile yet.");
    }
    response.json({ success: true, data: toProfileView(updated) });
  });

  return router;
}
