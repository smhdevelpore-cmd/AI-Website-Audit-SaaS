/**
 * Zod enums built from the one literal list in @siteaudit/shared-types. Nothing here
 * re-declares a value: a second list is a list that will disagree.
 */
import { z } from "zod";

import {
  AUDIT_CATEGORIES,
  AUDIT_STAGES,
  AUDIT_STATUSES,
  DIFFICULTIES,
  FINDING_CONFIDENCES,
  FINDING_SOURCES,
  FINDING_STATUSES,
  PRIORITIES,
  SEVERITIES,
} from "@siteaudit/shared-types";

export const auditStatusSchema = z.enum(AUDIT_STATUSES);
export const auditStageSchema = z.enum(AUDIT_STAGES);
export const auditCategorySchema = z.enum(AUDIT_CATEGORIES);
export const severitySchema = z.enum(SEVERITIES);
export const findingConfidenceSchema = z.enum(FINDING_CONFIDENCES);
export const findingSourceSchema = z.enum(FINDING_SOURCES);
export const findingStatusSchema = z.enum(FINDING_STATUSES);
export const difficultySchema = z.enum(DIFFICULTIES);
export const prioritySchema = z.enum(PRIORITIES);
