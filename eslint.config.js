import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".codex/**",
      ".vite/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "release/**",
      "test-results/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        console: "readonly",
        document: "readonly",
        HTMLButtonElement: "readonly",
        HTMLDivElement: "readonly",
        localStorage: "readonly",
        matchMedia: "readonly",
        process: "readonly",
        window: "readonly"
      }
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/consistent-type-imports": "error"
    }
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "off",
      "react-refresh/only-export-components": [
        "warn",
        { "allowConstantExport": true }
      ]
    }
  }
);
