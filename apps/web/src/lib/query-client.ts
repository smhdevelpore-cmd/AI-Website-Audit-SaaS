/**
 * One TanStack Query client for the app.
 *
 * The defaults are chosen for an authenticated dashboard over a slow, fallible API:
 *
 *  - `retry: 1` — a second attempt covers a dropped connection without making the user stare at
 *    a spinner for half a minute when the API is genuinely down.
 *  - `refetchOnWindowFocus: false` — a background refetch that rewrites a list
 *    while someone is reading it is worse than a slightly stale row; the poll in `useAudit`
 *    covers the case that actually needs freshness.
 */

import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 5_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: 0 },
    },
  });
}
