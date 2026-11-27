import { EnvError, loadWorkerEnv, type WorkerEnv } from "@siteaudit/config";

export function loadConfig(source: unknown = process.env): WorkerEnv {
  try {
    return loadWorkerEnv(source);
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(`[worker] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
