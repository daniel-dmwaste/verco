import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/**/*.test.{ts,tsx}', 'scripts/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'supabase/functions', 'src/__tests__/rls.test.ts'],
    globals: true,
    coverage: {
      include: ['src/lib/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
