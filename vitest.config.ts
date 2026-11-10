import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  // Dibaca di Node.js, lalu dikirim ke runtime Workers lewat binding TEST_MIGRATIONS
  const migrations = await readD1Migrations('./migrations')

  return {
    plugins: [
      cloudflareTest({
        // Pakai binding yang sama dengan wrangler.jsonc (DB, RATE_LIMITER)
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            API_KEY: 'test-api-key',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  }
})
