import { useCallback, useEffect, useState } from "react";

import { useAuth } from "../auth/AuthProvider.js";
import { config } from "../config.js";
import { ApiError, apiRequest } from "./api.js";

export interface Profile {
  id: string;
  name: string;
  agencyName: string | null;
  website: string | null;
  timezone: string | null;
  logoUrl: string | null;
  updatedAt: string;
}

type State =
  | { status: "loading" }
  | { status: "ready"; profile: Profile }
  | { status: "error"; message: string; code: string };

/**
 * Loads the signed-in user's profile from the API with the session's own token. One place for
 * the loading / ready / error states, so every screen treats them the same way.
 */
export function useProfile() {
  const { accessToken } = useAuth();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    if (accessToken === null) return;

    apiRequest<Profile>(config.VITE_API_BASE_URL, "/profile", { accessToken })
      .then((result) => {
        if (active) setState({ status: "ready", profile: result.data });
      })
      .catch((caught: unknown) => {
        if (!active) return;
        const apiError = caught instanceof ApiError ? caught : null;
        setState({
          status: "error",
          code: apiError?.code ?? "internal_error",
          message: apiError?.message ?? "We could not load your profile.",
        });
      });

    return () => {
      active = false;
    };
  }, [accessToken, attempt]);

  return { state, reload } as const;
}
