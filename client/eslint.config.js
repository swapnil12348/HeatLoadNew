import js from '@eslint/js'
import globals from 'globals'
import reactPlugin from 'eslint-plugin-react'
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
    plugins: {
      react: reactPlugin,
    },
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
      // react/jsx-uses-vars: marks a variable as "used" when it appears in JSX
      // as <ComponentName />. Without this rule, ESLint's no-unused-vars has no
      // knowledge of JSX and flags every imported component as unused —
      // even components actively used in return statements.
      'react/jsx-uses-vars': 'error',

      // react/jsx-uses-react: disabled — not needed with the React 19 new JSX
      // transform (react/react-in-jsx-scope is also not required).
      'react/jsx-uses-react': 'off',

      // varsIgnorePattern: SCREAMING_SNAKE_CASE constants only (e.g. BTU_PER_TON).
      // Intentionally does NOT exempt PascalCase — component imports that go
      // unused should be caught. The jsx-uses-vars rule above correctly marks
      // JSX-used components as used, so genuine component usage is not flagged.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z][A-Z0-9_]+$' }],
    },
  },
])