import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// Jalankan semua migration ke database D1 lokal sebelum test berjalan.
// applyD1Migrations bersifat idempotent: migration yang sudah diterapkan dilewati.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
