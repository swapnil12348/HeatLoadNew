import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,     // allows using describe, it, expect without importing them
    environment: 'jsdom', // needed for React component testing

    // setupFiles: removed — './src/setupTests.js' does not exist in the project.
    // Vitest throws "Cannot find module" before any test runs when this points
    // to a missing file. Re-add when you create the file, e.g.:
    //   setupFiles: './src/setupTests.js'
    // Minimal content for that file to import jest-dom matchers:
    //   import '@testing-library/jest-dom'
  },
})