import { createMiddleware } from 'hono/factory'
import { ApiError } from '../lib/errors'

const encoder = new TextEncoder()

/**
 * Bandingkan dua string dalam waktu konstan (constant-time).
 * Keduanya di-hash dulu dengan SHA-256 agar panjangnya selalu sama,
 * lalu dibandingkan dengan crypto.subtle.timingSafeEqual (API khusus Workers).
 * Ini mencegah timing attack (menebak key karakter demi karakter dari lama respons).
 */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  return crypto.subtle.timingSafeEqual(ha, hb)
}

/**
 * Autentikasi sederhana dengan API key: `Authorization: Bearer <API_KEY>`.
 * API_KEY disimpan sebagai secret Worker, bukan di kode.
 */
export const requireApiKey = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const expected = c.env.API_KEY
  if (!expected) {
    // Fail closed: jika secret lupa dipasang, tolak semua request.
    throw new ApiError(500, 'SERVER_MISCONFIGURED', 'API_KEY belum dikonfigurasi di server')
  }

  const header = c.req.header('Authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match) {
    c.header('WWW-Authenticate', 'Bearer')
    throw new ApiError(401, 'UNAUTHORIZED', 'Header Authorization: Bearer <API_KEY> wajib disertakan')
  }

  if (!(await safeEqual(match[1].trim(), expected))) {
    c.header('WWW-Authenticate', 'Bearer error="invalid_token"')
    throw new ApiError(401, 'UNAUTHORIZED', 'API key tidak valid')
  }

  await next()
})
