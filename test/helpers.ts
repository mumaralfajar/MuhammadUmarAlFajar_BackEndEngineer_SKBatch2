import { env } from 'cloudflare:workers'
import app from '../src/index'

export const API_KEY = 'test-api-key'

let ipCounter = 0

type RequestOptions = {
  body?: unknown
  rawBody?: string
  apiKey?: string | null
  ip?: string
}

/**
 * Kirim request ke aplikasi Hono langsung lewat app.request(),
 * dengan binding Workers asli (D1, rate limiter) dari runtime test.
 * Setiap request memakai IP unik secara default agar tidak terkena rate limit,
 * kecuali test sengaja memberi `ip` yang sama.
 */
export function call(method: string, path: string, opts: RequestOptions = {}) {
  const headers: Record<string, string> = {
    'CF-Connecting-IP': opts.ip ?? `10.0.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`,
  }
  if (opts.apiKey !== null) headers.Authorization = `Bearer ${opts.apiKey ?? API_KEY}`

  let body: string | undefined
  if (opts.rawBody !== undefined) body = opts.rawBody
  else if (opts.body !== undefined) body = JSON.stringify(opts.body)
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  return app.request(path, { method, headers, body }, env)
}

let emailCounter = 0
export const validApplicant = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Budi Santoso',
  email: `budi${Date.now()}${emailCounter++}@example.com`,
  phone: '+6281234567890',
  position: 'Backend Engineer',
  ...overrides,
})

export async function createApplicant(overrides: Record<string, unknown> = {}) {
  const res = await call('POST', '/applicants', { body: validApplicant(overrides) })
  if (res.status !== 201) throw new Error(`createApplicant gagal: ${res.status} ${await res.text()}`)
  return (await res.json()) as { id: string; email: string; stage: string }
}
