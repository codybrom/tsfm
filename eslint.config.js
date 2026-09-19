import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-eval": "error",
      "no-debugger": "error",
    },
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // native/ holds the vendored Swift bridge (see native/UPSTREAM.md) and build output.
    ignores: ["dist/", "node_modules/", "native/", ".build/"],
  },
);
