/**
 * Browser configuration. Only `VITE_` variables exist here, and `loadWebEnv` refuses a
 * document that carries a server-only key — this file's output is public by definition.
 */
import { loadWebEnv } from "@siteaudit/config";

export const config = loadWebEnv(import.meta.env);
