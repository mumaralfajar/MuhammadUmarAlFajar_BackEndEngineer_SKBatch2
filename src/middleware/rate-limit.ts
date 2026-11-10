import { createMiddleware } from 'hono/factory'
import { ApiError } from '../lib/errors'

/**
 * Rate limit per alamat IP memakai binding Workers Rate Limiting (`RATE_LIMITER`).
 * Batasnya (limit/period) diatur di wrangler.jsonc, bukan di kode.
 *
 * Catatan: counter disimpan per lokasi data center Cloudflare dan bersifat
 * "eventually consistent", jadi angkanya mendekati, bukan presisi absolut.
 * Ini cukup untuk melindungi kuota free tier dari spam/abuse.
 */
export const rateLimit = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const { success } = await c.env.RATE_LIMITER.limit({ key: `ip:${ip}` })

  if (!success) {
    c.header('Retry-After', '60')
    throw new ApiError(429, 'RATE_LIMITED', 'Terlalu banyak request. Coba lagi dalam 60 detik.')
  }

  await next()
})
