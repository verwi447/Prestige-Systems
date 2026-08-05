import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "src/daemon/**", "uploads/**", ".backup-imports/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-constant-condition": ["error", { checkLoops: false }]
    }
  },
  {
    files: ["test/**/*.js", "integration/**/*.js", "e2e/**/*.js", "playwright.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-constant-condition": ["error", { checkLoops: false }]
    }
  }
];
