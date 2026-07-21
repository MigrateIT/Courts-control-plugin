import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  eslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      globals: {
        console: "readonly",
        navigator: "readonly",
        process: "readonly",
        sessionStorage: "readonly",
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs["recommended-type-checked"].rules,
      "no-redeclare": "off",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["test/browser/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["test/browser/*.mjs", "test/live/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
  {
    ignores: ["assets/**", "coverage/**", "dist/**"],
  },
];
