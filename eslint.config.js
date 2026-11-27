import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "tools/sloplint/**",
      ".agents/**",
      ".venv/**",
      "graphify-out/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Untrusted strings never get a free pass: explicit checks beat assertions.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "off",
    },
  },
  {
    files: ["apps/web/**/*.tsx", "apps/web/**/*.ts"],
    languageOptions: { globals: { ...globals.browser } },
  },
  prettier,
);
