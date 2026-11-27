/**
 * The API's environment, validated once at startup.
 *
 * A bad environment is a deployment mistake, so it prints the variable names and exits 1 —
 * not a stack trace, and never a value (values may be secrets).
 */
import { EnvError, loadApiEnv, type ApiEnv } from "@siteaudit/config";

export function loadConfig(source: unknown = process.env): ApiEnv {
  try {
    return loadApiEnv(source);
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(`[api] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
