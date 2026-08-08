import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "android/**/build/**",
      "android/.gradle/**",
      ".android-sdk/**",
      ".codex-remote-attachments/**",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // This legacy codebase is not strict-mode TypeScript yet. Keep the lint
      // gate focused on runtime defects while type coverage is improved
      // incrementally through the dedicated TypeScript build.
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Shadcn-style primitives intentionally co-export their variant helpers,
    // and AlbumDetail exports pure URL/entitlement helpers used by regression
    // tests. These exports are stable and do not represent hot-reload state.
    files: ["src/components/ui/**/*.{ts,tsx}", "src/pages/AlbumDetail.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
);
