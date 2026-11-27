/**
 * API process bootstrap: configuration in, listening socket out.
 *
 * The application itself is built by `createApp` from `app.ts`, which takes its dependencies as
 * arguments. This file is the only place that reads the environment and constructs the real
 * Supabase-backed auth context.
 */
import { createApp } from "./app.js";
import { buildAuthContext } from "./auth/context.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const auth = buildAuthContext(config);
const app = createApp({ auth });

app.listen(config.PORT, () => {
  console.log(
    `[api] listening on ${config.PORT} (${config.NODE_ENV}, auth ${auth === null ? "not configured" : "ready"})`,
  );
});
