/**
 * Turns configuration into an `AuthContext`, or into `null` when this deployment has no
 * Supabase project to talk to.
 *
 * The token key is chosen here and nowhere else:
 *   - `SUPABASE_JWT_SECRET` (legacy HS256) when present,
 *   - otherwise the project's published JWKS over HTTPS.
 *
 * The service-role key is not read in this file. Verifying a user's token does not require it,
 * and a request path that never loads it cannot accidentally send it.
 */

import { createRemoteJWKSet } from "jose";

import type { ApiEnv } from "@siteaudit/config";

import { createTokenVerifier, type TokenVerifier } from "./token.js";
import type { AuthContext } from "./middleware.js";
import { createSupabaseUserDataFactory } from "../data/supabase.js";

export function buildTokenVerifier(config: ApiEnv): TokenVerifier | null {
  if (config.SUPABASE_JWT_SECRET !== undefined) {
    return createTokenVerifier({
      key: new TextEncoder().encode(config.SUPABASE_JWT_SECRET),
      algorithms: ["HS256"],
      ...(config.SUPABASE_JWT_ISSUER === undefined ? {} : { issuer: config.SUPABASE_JWT_ISSUER }),
    });
  }

  if (config.SUPABASE_JWKS_URL !== undefined) {
    return createTokenVerifier({
      key: createRemoteJWKSet(new URL(config.SUPABASE_JWKS_URL)),
      algorithms: ["RS256", "ES256"],
      ...(config.SUPABASE_JWT_ISSUER === undefined ? {} : { issuer: config.SUPABASE_JWT_ISSUER }),
    });
  }

  return null;
}

export function buildAuthContext(config: ApiEnv): AuthContext | null {
  const verifyToken = buildTokenVerifier(config);
  if (verifyToken === null || config.SUPABASE_URL === undefined || config.SUPABASE_ANON_KEY === undefined) {
    return null;
  }

  return {
    verifyToken,
    createUserData: createSupabaseUserDataFactory({
      url: config.SUPABASE_URL,
      anonKey: config.SUPABASE_ANON_KEY,
    }),
  };
}
