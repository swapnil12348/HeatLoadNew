import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),tailwindcss()],
  test: {
    globals: true, // allows using describe, it, expect without importing them
    environment: 'jsdom', // needed for React component testing
    setupFiles: './src/setupTests.js', // (optional, create this if you need global setups)
  },
})
