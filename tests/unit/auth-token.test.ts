/**
 * Token verification, with real signatures.
 *
 * Every token below is signed by `jose` and verified by the same code the API runs. Nothing is
 * stubbed except the key source, which is injected by design.
 */

import { SignJWT, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";

import { AppError } from "@siteaudit/shared-types";

import { createTokenVerifier } from "../../apps/api/src/auth/token.js";

const SECRET = new TextEncoder().encode("a-test-secret-long-enough-for-hs256-signing");
const USER_ID = "6f1b4c1e-0f3a-4a8e-9a4d-2b3c4d5e6f70";

interface ClaimOptions {
  sub?: string | null;
  role?: string;
  aud?: string;
  email?: string;
  expiresInSeconds?: number;
  secret?: Uint8Array;
  alg?: "HS256" | "HS512";
}

async function sign(options: ClaimOptions = {}): Promise<string> {
  const claims: Record<string, unknown> = {};
  if (options.sub !== null) claims["sub"] = options.sub ?? USER_ID;
  if (options.role !== undefined) claims["role"] = options.role;
  if (options.email !== undefined) claims["email"] = options.email;

  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: options.alg ?? "HS256" })
    .setAudience(options.aud ?? "authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + (options.expiresInSeconds ?? 300))
    .sign(options.secret ?? SECRET);
}

const verifier = createTokenVerifier({ key: SECRET, algorithms: ["HS256"] });

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected the token to be rejected");
}

describe("valid tokens", () => {
  it("accepts a signed token and returns the user id", async () => {
    const user = await verifier.verify(await sign({ email: "a@example.com" }));
    expect(user).toEqual({ id: USER_ID, email: "a@example.com" });
  });

  it("accepts a token whose role claim is authenticated", async () => {
    await expect(verifier.verify(await sign({ role: "authenticated" }))).resolves.toMatchObject({
      id: USER_ID,
    });
  });

  it("treats a missing email as null rather than inventing one", async () => {
    const user = await verifier.verify(await sign());
    expect(user.email).toBeNull();
  });
});

describe("rejected tokens", () => {
  it("rejects an expired token with a message a user can act on", async () => {
    const error = await rejection(verifier.verify(await sign({ expiresInSeconds: -60 })));
    expect(error.code).toBe("unauthenticated");
    expect(error.status).toBe(401);
    expect(error.message).toMatch(/expired/i);
    expect(error.logContext["reason"]).toBe("expired");
  });

  it("rejects a token signed with another secret", async () => {
    const error = await rejection(
      verifier.verify(
        await sign({ secret: new TextEncoder().encode("some-other-secret-of-sufficient-length") }),
      ),
    );
    expect(error.code).toBe("unauthenticated");
  });

  it("rejects a token issued for a different audience", async () => {
    const error = await rejection(verifier.verify(await sign({ aud: "anon" })));
    expect(error.logContext["reason"]).toBe("invalid_token");
  });

  it("refuses a service_role token, which would bypass RLS", async () => {
    const error = await rejection(verifier.verify(await sign({ role: "service_role" })));
    expect(error.code).toBe("unauthenticated");
    expect(error.logContext["reason"]).toBe("wrong_role");
  });

  it("rejects a token without a subject", async () => {
    const error = await rejection(verifier.verify(await sign({ sub: null })));
    expect(error.logContext["reason"]).toBe("invalid_subject");
  });

  it("rejects a subject that is not a uuid", async () => {
    const error = await rejection(verifier.verify(await sign({ sub: "1' or '1'='1" })));
    expect(error.logContext["reason"]).toBe("invalid_subject");
  });

  it("rejects nonsense, an unsigned token and an empty string", async () => {
    for (const token of ["not-a-token", "a.b.c", "", "eyJhbGciOiJub25lIn0.e30."]) {
      const error = await rejection(verifier.verify(token));
      expect(error.code).toBe("unauthenticated");
    }
  });

  it("does not accept HS256 when only the HMAC algorithm family was named", async () => {
    // An `alg` outside the configured list is an algorithm-confusion attempt, not a token.
    const hs512 = await sign({ alg: "HS512" });
    await rejection(verifier.verify(hs512));
  });

  it("enforces the configured issuer", async () => {
    const strict = createTokenVerifier({
      key: SECRET,
      algorithms: ["HS256"],
      issuer: "https://project.supabase.co/auth/v1",
    });
    const unsignedForIssuer = await new SignJWT({ sub: USER_ID })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("authenticated")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(SECRET);
    const error = await rejection(strict.verify(unsignedForIssuer));
    expect(error.logContext["reason"]).toBe("invalid_token");
  });
});

describe("asymmetric keys (Supabase JWKS signing keys)", () => {
  it("verifies a token against a public key resolved from the header", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const token = await new SignJWT({ sub: USER_ID, role: "authenticated" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setAudience("authenticated")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const resolver = createTokenVerifier({
      key: async (header) => {
        expect(header.kid).toBe("test-key");
        return publicKey;
      },
      algorithms: ["RS256"],
    });

    await expect(resolver.verify(token)).resolves.toMatchObject({ id: USER_ID });
  });

  it("rejects an HS256 token when asymmetric keys are configured", async () => {
    const { publicKey } = await generateKeyPair("RS256", { extractable: true });
    const resolver = createTokenVerifier({ key: async () => publicKey, algorithms: ["RS256"] });
    const error = await rejection(resolver.verify(await sign()));
    expect(error.code).toBe("unauthenticated");
  });
});
