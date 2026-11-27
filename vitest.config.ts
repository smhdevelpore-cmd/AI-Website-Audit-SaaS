import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests resolve workspace packages from source, so `npm test` needs no build first.
    alias: {
      "@siteaudit/audit-rules": pkg("audit-rules"),
      "@siteaudit/config": pkg("config"),
      "@siteaudit/report-template": pkg("report-template"),
      "@siteaudit/shared-types": pkg("shared-types"),
      "@siteaudit/validation": pkg("validation"),
    },
  },
  test: {
    include: ["packages/**/src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
});
