import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // varsIgnorePattern: previously '^[A-Z_]' — too broad.
      // That pattern exempted any variable starting with uppercase or underscore,
      // including `React` itself. Dead `import React from 'react'` imports
      // accumulated across the entire codebase without a single lint warning.
      //
      // Narrowed to SCREAMING_SNAKE_CASE constants only (e.g. SOME_CONSTANT).
      // React component names (PascalCase) are intentionally NOT exempt —
      // if a component import goes unused, the linter should catch it.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z][A-Z0-9_]+$' }],
    },
  },
])