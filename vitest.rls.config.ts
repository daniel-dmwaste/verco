import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Dedicated config for RLS tests — these hit the remote Supabase project so
 * they're excluded from the default `pnpm test` run. Invoke explicitly with
 * `pnpm test:rls`.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/rls.test.ts'],
    globals: true,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
