/**
 * Bearer token verification (TRD §1, "Supabase token verification").
 *
 * The API verifies the token itself instead of asking the Auth server on every request: a
 * network round trip to validate a signature is a dependency that can fail under load, and a
 * signature is checkable with a key we already hold.
 *
 * Two signing schemes are supported because Supabase projects differ: the legacy HS256 shared
 * secret, and asymmetric keys published as a JWKS. The key source is injected, so tests can
 * verify against a real generated key pair without any network access.
 */

import { errors, jwtVerify, type CryptoKey, type JWTVerifyGetKey } from "jose";

import { AppError } from "@siteaudit/shared-types";

/** Who the request is acting as. Never a token, never a role other than `authenticated`. */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string | null;
}

export interface TokenVerifier {
  /** Throws `AppError('unauthenticated')` unless the token is genuine, current and for a user. */
  verify(token: string): Promise<AuthenticatedUser>;
}

export const SUPABASE_AUDIENCE = "authenticated";

export interface TokenVerifierConfig {
  /** `Uint8Array`/`CryptoKey` for a fixed key, or a resolver (e.g. `createRemoteJWKSet`). */
  readonly key: Uint8Array | CryptoKey | JWTVerifyGetKey;
  /** Algorithms the caller is willing to accept. An unexpected `alg` is a rejected token. */
  readonly algorithms: readonly string[];
  readonly issuer?: string | undefined;
  readonly audience?: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unauthenticated(message: string, reason: string, cause?: unknown): AppError {
  return new AppError("unauthenticated", message, { logContext: { reason }, cause });
}

export function createTokenVerifier(config: TokenVerifierConfig): TokenVerifier {
  const audience = config.audience ?? SUPABASE_AUDIENCE;

  return {
    async verify(token: string): Promise<AuthenticatedUser> {
      let payload: Record<string, unknown>;
      try {
        const result = await jwtVerify(token, config.key as Parameters<typeof jwtVerify>[1], {
          algorithms: [...config.algorithms],
          audience,
          ...(config.issuer === undefined ? {} : { issuer: config.issuer }),
        });
        payload = result.payload as Record<string, unknown>;
      } catch (error) {
        if (error instanceof errors.JWTExpired) {
          throw unauthenticated("Your session has expired. Sign in again.", "expired", error);
        }
        throw unauthenticated("That sign-in token is not valid.", "invalid_token", error);
      }

      const subject = payload["sub"];
      if (typeof subject !== "string" || !UUID.test(subject)) {
        throw unauthenticated("That sign-in token is not valid.", "invalid_subject");
      }

      // A service token must never be usable as a user. It bypasses RLS, so accepting it here
      // would turn an operator key into every tenant's key.
      const role = payload["role"];
      if (role !== undefined && role !== "authenticated") {
        throw unauthenticated("That sign-in token is not valid.", "wrong_role");
      }

      return {
        id: subject.toLowerCase(),
        email: typeof payload["email"] === "string" ? payload["email"] : null,
      };
    },
  };
}
