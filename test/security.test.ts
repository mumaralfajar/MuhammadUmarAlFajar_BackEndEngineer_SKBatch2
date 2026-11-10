import { describe, expect, it } from 'vitest'
import { call } from './helpers'

describe('Autentikasi', () => {
  it('401 tanpa header Authorization', async () => {
    const res = await call('GET', '/applicants', { apiKey: null })
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer')
    expect(((await res.json()) as any).error.code).toBe('UNAUTHORIZED')
  })

  it('401 dengan API key yang salah', async () => {
    const res = await call('POST', '/applicants', { apiKey: 'salah', body: {} })
    expect(res.status).toBe(401)
  })

  it('route publik tidak butuh API key', async () => {
    expect((await call('GET', '/health', { apiKey: null })).status).toBe(200)
    expect((await call('GET', '/docs', { apiKey: null })).status).toBe(200)
    expect((await call('GET', '/openapi.json', { apiKey: null })).status).toBe(200)
  })
})

describe('Rate limit', () => {
  it('429 setelah melewati 60 request per menit dari IP yang sama', async () => {
    const ip = '203.0.113.7'
    const statuses: number[] = []
    for (let i = 0; i < 61; i++) {
      statuses.push((await call('GET', '/applicants?limit=1', { ip })).status)
    }
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true)

    const last = await call('GET', '/applicants?limit=1', { ip })
    expect(last.status).toBe(429)
    expect(last.headers.get('Retry-After')).toBe('60')
    expect(((await last.json()) as any).error.code).toBe('RATE_LIMITED')
  })

  it('IP lain tidak ikut terblokir', async () => {
    expect((await call('GET', '/applicants?limit=1', { ip: '198.51.100.1' })).status).toBe(200)
  })
})

describe('Dokumentasi OpenAPI', () => {
  it('memuat semua endpoint dan skema keamanan', async () => {
    const spec = (await (await call('GET', '/openapi.json')).json()) as any
    expect(spec.openapi).toBe('3.1.0')
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/applicants', '/applicants/{id}', '/applicants/{id}/stage']),
    )
    expect(Object.keys(spec.paths['/applicants/{id}'])).toEqual(expect.arrayContaining(['get', 'delete']))
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe('bearer')
  })
})

it('404 JSON untuk route yang tidak ada', async () => {
  const res = await call('GET', '/tidak-ada')
  expect(res.status).toBe(404)
  expect(((await res.json()) as any).error.code).toBe('ROUTE_NOT_FOUND')
})
