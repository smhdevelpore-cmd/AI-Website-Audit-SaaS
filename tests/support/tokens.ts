/** Real HS256 tokens, signed with a test secret, so the production verifier is what runs. */

import { SignJWT } from "jose";

export const TEST_SECRET = new TextEncoder().encode("a-test-secret-long-enough-for-hs256-signing");

export const ALICE = "11111111-1111-4111-8111-111111111111";
export const BOB = "22222222-2222-4222-8222-222222222222";

export async function signTestToken(userId: string, expiresInSeconds = 300): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: userId, role: "authenticated", email: `${userId.slice(0, 4)}@example.com` })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(TEST_SECRET);
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
