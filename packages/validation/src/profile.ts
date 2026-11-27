/**
 * Profile contract (PRD FR-02). The profile website is stored, never fetched, so it gets the
 * syntactic half of the target gate — scheme, credentials, hostname shape — without DNS.
 */

import { z } from "zod";

import { UnsafeTargetError, parseTargetUrl, publicMessageFor } from "./target-url.js";

export const PROFILE_NAME_MAX_LENGTH = 80;
export const AGENCY_NAME_MAX_LENGTH = 120;
export const TIMEZONE_MAX_LENGTH = 64;

/** A URL a user typed that we only ever display. */
const displayUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .superRefine((value, ctx) => {
    try {
      parseTargetUrl(value);
    } catch (error) {
      const message =
        error instanceof UnsafeTargetError ? publicMessageFor(error.reason) : "That address cannot be used.";
      ctx.addIssue({ code: "custom", message });
    }
  });

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(TIMEZONE_MAX_LENGTH)
  .refine(
    (zone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Use a time zone name such as Europe/Berlin." },
  );

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(PROFILE_NAME_MAX_LENGTH),
  agencyName: z.string().trim().min(1).max(AGENCY_NAME_MAX_LENGTH).optional(),
  website: displayUrlSchema.optional(),
  timezone: timezoneSchema.optional(),
  logoUrl: displayUrlSchema.optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
