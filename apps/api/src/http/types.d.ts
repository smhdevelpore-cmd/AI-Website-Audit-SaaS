/**
 * What `requireAuth` attaches to a request. Declared by augmenting the Express types, so a route
 * can read `request.user` and `request.data` with types instead of casting.
 */
import type { AuthenticatedUser } from "../auth/token.js";
import type { UserData } from "../data/types.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
    /** Data access scoped to `user` by the caller's own token. */
    data?: UserData;
  }
}

export {};
