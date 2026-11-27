/**
 * `requireAuth`: the only way a route learns who is calling.
 *
 * It does two things and no more — verify the bearer token, then hand the route a data client
 * bound to that token. Routes never see the raw token and never build a client of their own.
 */

import type { RequestHandler } from "express";

import { AppError } from "@siteaudit/shared-types";

import type { AuthenticatedUser, TokenVerifier } from "./token.js";
import type { UserData, UserDataFactory } from "../data/types.js";

export interface AuthContext {
  readonly verifyToken: TokenVerifier;
  readonly createUserData: UserDataFactory;
}

export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim() ?? "";
  return token === "" ? null : token;
}

export function requireAuth(auth: AuthContext): RequestHandler {
  return async (request, _response, next) => {
    try {
      const token = bearerToken(request.headers.authorization);
      if (token === null) {
        throw new AppError("unauthenticated", "Sign in to continue.");
      }

      const user: AuthenticatedUser = await auth.verifyToken.verify(token);
      request.user = user;
      request.data = auth.createUserData(token);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** The caller, or an error. Routes run after `requireAuth`, so absence is a wiring bug. */
export function currentUser(request: { user?: AuthenticatedUser }): AuthenticatedUser {
  if (request.user === undefined) {
    throw new AppError("unauthenticated", "Sign in to continue.", {
      logContext: { reason: "requireAuth_missing" },
    });
  }
  return request.user;
}

export function currentData(request: { data?: UserData }): UserData {
  if (request.data === undefined) {
    throw new AppError("internal_error", "Something went wrong on our side.", {
      logContext: { reason: "data_client_missing" },
    });
  }
  return request.data;
}
