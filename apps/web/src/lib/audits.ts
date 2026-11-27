/**
 * Audits, from the browser's side: one place that knows the endpoint shapes, the query keys and
 * how often to ask again.
 *
 * The polling rule is the interesting one. A queued or running audit is the only thing on this
 * site that changes without a user action, so it is the only thing that refetches on a timer —
 * and it stops as soon as the audit reaches a terminal status, because a page that keeps asking
 * about a finished audit is a page wasting someone's battery.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { isTerminalAuditStatus, type AuditStatus, type CategoryScore } from "@siteaudit/shared-types";

import { useAuth } from "../auth/AuthProvider.js";
import { config } from "../config.js";
import { apiRequest } from "./api.js";

export interface AuditFailure {
  code: string;
  message: string;
}

export interface Audit {
  id: string;
  url: string;
  host: string;
  clientName: string | null;
  projectName: string | null;
  status: AuditStatus;
  stage: string | null;
  maxPages: number;
  pagesScanned: number;
  partial: boolean;
  /** 0–100 over the categories the scan could check; null until a score exists. */
  overallScore: number | null;
  /** Per-category score and weight; `score: null` is "not checked", never zero. */
  categoryScores: readonly CategoryScore[] | null;
  error: AuditFailure | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AuditListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface AuditList {
  rows: Audit[];
  meta: AuditListMeta;
}

export interface AuditQuery {
  page: number;
  limit: number;
  status?: AuditStatus;
  search?: string;
}

export interface NewAudit {
  url: string;
  clientName?: string;
  projectName?: string;
  maxPages?: number;
}

function queryString(query: AuditQuery): string {
  const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
  if (query.status !== undefined) params.set("status", query.status);
  if (query.search !== undefined && query.search.trim() !== "") params.set("search", query.search.trim());
  return params.toString();
}

const META_FALLBACK: AuditListMeta = { page: 1, limit: 20, total: 0, totalPages: 1, hasMore: false };

export async function fetchAudits(accessToken: string, query: AuditQuery): Promise<AuditList> {
  const result = await apiRequest<Audit[]>(config.VITE_API_BASE_URL, `/audits?${queryString(query)}`, {
    accessToken,
  });
  return {
    rows: result.data,
    meta: { ...META_FALLBACK, ...(result.meta as Partial<AuditListMeta> | undefined) },
  };
}

export async function fetchAudit(accessToken: string, auditId: string): Promise<Audit> {
  const result = await apiRequest<Audit>(config.VITE_API_BASE_URL, `/audits/${auditId}`, {
    accessToken,
  });
  return result.data;
}

export async function createAudit(accessToken: string, input: NewAudit): Promise<Audit> {
  const result = await apiRequest<Audit>(config.VITE_API_BASE_URL, "/audits", {
    method: "POST",
    body: {
      url: input.url,
      ...(input.clientName === undefined || input.clientName === "" ? {} : { clientName: input.clientName }),
      ...(input.projectName === undefined || input.projectName === ""
        ? {}
        : { projectName: input.projectName }),
      ...(input.maxPages === undefined ? {} : { scanScope: { maxPages: input.maxPages } }),
    },
    accessToken,
  });
  return result.data;
}

export async function cancelAudit(accessToken: string, auditId: string): Promise<void> {
  await apiRequest<void>(config.VITE_API_BASE_URL, `/audits/${auditId}`, {
    method: "DELETE",
    accessToken,
  });
}

const listKey = (query: AuditQuery) => ["audits", "list", query] as const;
const detailKey = (auditId: string) => ["audits", "detail", auditId] as const;

/** How often a live audit is polled. Two seconds is fast enough to feel alive, slow enough to be polite. */
export const POLL_INTERVAL_MS = 2_000;

export function useAudits(query: AuditQuery) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [...listKey(query), accessToken],
    queryFn: () => fetchAudits(accessToken ?? "", query),
    enabled: accessToken !== null,
    placeholderData: keepPreviousData,
  });
}

export function useAudit(auditId: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [...detailKey(auditId), accessToken],
    queryFn: () => fetchAudit(accessToken ?? "", auditId),
    enabled: accessToken !== null && auditId !== "",
    refetchInterval: (query) => {
      const audit = query.state.data;
      if (audit === undefined) return false;
      return isTerminalAuditStatus(audit.status) ? false : POLL_INTERVAL_MS;
    },
  });
}

export function useCreateAudit() {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: NewAudit) => createAudit(accessToken ?? "", input),
    onSuccess: (audit) => {
      void client.invalidateQueries({ queryKey: ["audits"] });
      client.setQueryData([...detailKey(audit.id), accessToken], audit);
    },
  });
}

export function useCancelAudit() {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (auditId: string) => cancelAudit(accessToken ?? "", auditId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["audits"] });
    },
  });
}
