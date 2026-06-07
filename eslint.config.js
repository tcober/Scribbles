import js from "@eslint/js";
import vue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Flat config. The project is ESM JavaScript (no TypeScript) split across a Vue
// renderer (browser) and an Electron main process (Node), so each side gets its
// own globals. Prettier owns formatting; ESLint here is for correctness plus the
// two CLAUDE.md conventions worth machine-enforcing (no single-letter names,
// SFC block order).
export default [
  {
    ignores: [
      "dist/**",
      "release/**",
      "node_modules/**",
      "resources/**",
      ".whisper-build/**",
      "coverage/**",
    ],
  },

  js.configs.recommended,
  ...vue.configs["flat/recommended"],
  prettier,

  {
    rules: {
      // CLAUDE.md: whole words, never single letters.
      "id-length": [
        "error",
        { min: 2, properties: "never", exceptions: ["_"] },
      ],
      // CLAUDE.md: <template>, then <script setup>, then <style scoped>.
      "vue/block-order": ["error", { order: ["template", "script", "style"] }],
      // App.vue is the legitimately single-word root component.
      "vue/multi-word-component-names": "off",
      // Attribute ordering isn't a documented project convention; don't impose one.
      "vue/attributes-order": "off",
      // Intentional best-effort swallows (window gone, file already deleted).
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },

  {
    files: ["src/**/*.{js,vue}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
    },
  },

  {
    files: [
      "electron/**/*.js",
      "scripts/**/*.js",
      "*.config.js",
      "vitest.setup.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },

  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },

  {
    files: ["**/*.spec.js", "**/__tests__/**/*.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
