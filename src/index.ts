import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { ApiError, errorBody } from './lib/errors'
import { validationHook } from './lib/validation'
import { requireApiKey } from './middleware/auth'
import { rateLimit } from './middleware/rate-limit'
import { applicants } from './routes/applicants'

const app = new OpenAPIHono<{ Bindings: Env }>({ defaultHook: validationHook })

// ---- Middleware global ------------------------------------------------------
app.use('*', logger())
app.use('*', secureHeaders())

// Rate limit dipasang SEBELUM auth, supaya percobaan menebak API key juga dibatasi.
// Catatan: pola '/applicants/*' di Hono juga cocok dengan '/applicants' itu sendiri.
app.use('/applicants/*', rateLimit, requireApiKey)

// ---- Route publik -----------------------------------------------------------
app.get('/', (c) => c.redirect('/docs'))
app.get('/health', (c) => c.json({ status: 'ok' }))

// ---- Route API --------------------------------------------------------------
app.route('/applicants', applicants)

// ---- Dokumentasi OpenAPI + Swagger UI ---------------------------------------
app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'Isi dengan nilai API_KEY (tanpa kata "Bearer").',
})

app.doc31('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Sekolah Karir — Applicant API',
    version: '1.0.0',
    description:
      'API untuk mengelola data pelamar: create, list, detail, update stage, dan delete. ' +
      'Dibangun dengan Hono + Cloudflare Workers + D1.',
  },
  tags: [{ name: 'Applicants', description: 'Manajemen data pelamar' }],
})

app.get('/docs', swaggerUI({ url: '/openapi.json' }))

// ---- Penanganan error terpusat ----------------------------------------------
app.notFound((c) => c.json(errorBody('ROUTE_NOT_FOUND', `Route ${c.req.method} ${c.req.path} tidak ada`), 404))

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(errorBody(err.code, err.message, err.details), err.status)
  }
  // HTTPException dilempar oleh Hono sendiri, mis. body JSON rusak (400)
  // sebelum sempat divalidasi Zod.
  if (err instanceof HTTPException) {
    const code = err.status === 400 ? 'INVALID_JSON' : 'HTTP_ERROR'
    const message = err.status === 400 ? 'Body request bukan JSON yang valid' : err.message
    return c.json(errorBody(code, message), err.status)
  }
  console.error('Unhandled error:', err)
  return c.json(errorBody('INTERNAL_ERROR', 'Terjadi kesalahan pada server'), 500)
})

export default app
