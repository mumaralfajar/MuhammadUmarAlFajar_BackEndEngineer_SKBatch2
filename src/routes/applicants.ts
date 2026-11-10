import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import {
  deleteApplicant,
  findApplicantById,
  insertApplicant,
  isUniqueViolation,
  listApplicants,
  updateApplicantStage,
} from '../db/applicants'
import { ApiError } from '../lib/errors'
import { ALLOWED_TRANSITIONS, canTransition } from '../lib/stages'
import { validationHook } from '../lib/validation'
import {
  ApplicantListSchema,
  ApplicantSchema,
  CreateApplicantSchema,
  ErrorSchema,
  IdParamSchema,
  ListQuerySchema,
  UpdateStageSchema,
} from '../schemas/applicant'

const tags = ['Applicants']
const security = [{ bearerAuth: [] }]

/** Respons error yang dipakai bersama, hanya untuk dokumentasi Swagger. */
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorSchema } },
})
const commonErrors = {
  401: errorResponse('API key tidak ada atau salah'),
  429: errorResponse('Terlalu banyak request (rate limit)'),
}

// ---------------------------------------------------------------------------
// Definisi route (kontrak OpenAPI). Hono memvalidasi request berdasarkan ini.
// ---------------------------------------------------------------------------

const createApplicantRoute = createRoute({
  method: 'post',
  path: '/',
  tags,
  security,
  summary: 'Buat pelamar baru',
  description: 'Pelamar baru selalu dimulai dari stage `applied`.',
  request: {
    body: { required: true, content: { 'application/json': { schema: CreateApplicantSchema } } },
  },
  responses: {
    201: { description: 'Pelamar dibuat', content: { 'application/json': { schema: ApplicantSchema } } },
    400: errorResponse('Input tidak valid'),
    409: errorResponse('Email sudah terdaftar'),
    ...commonErrors,
  },
})

const listApplicantsRoute = createRoute({
  method: 'get',
  path: '/',
  tags,
  security,
  summary: 'Daftar pelamar',
  description: 'Mendukung filter `stage`, pencarian `q` (nama/email), dan paginasi `limit`/`offset`.',
  request: { query: ListQuerySchema },
  responses: {
    200: { description: 'Daftar pelamar', content: { 'application/json': { schema: ApplicantListSchema } } },
    400: errorResponse('Query parameter tidak valid'),
    ...commonErrors,
  },
})

const getApplicantRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags,
  security,
  summary: 'Detail pelamar',
  request: { params: IdParamSchema },
  responses: {
    200: { description: 'Detail pelamar', content: { 'application/json': { schema: ApplicantSchema } } },
    400: errorResponse('id bukan UUID'),
    404: errorResponse('Pelamar tidak ditemukan'),
    ...commonErrors,
  },
})

const updateStageRoute = createRoute({
  method: 'patch',
  path: '/{id}/stage',
  tags,
  security,
  summary: 'Ubah stage pelamar',
  description:
    'Alur yang diizinkan: applied → screening → interview → offer → hired. ' +
    'Semua stage aktif boleh ke `rejected`. `hired` dan `rejected` adalah stage akhir.',
  request: {
    params: IdParamSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateStageSchema } } },
  },
  responses: {
    200: { description: 'Stage diperbarui', content: { 'application/json': { schema: ApplicantSchema } } },
    400: errorResponse('Input tidak valid'),
    404: errorResponse('Pelamar tidak ditemukan'),
    409: errorResponse('Stage berubah oleh request lain secara bersamaan'),
    422: errorResponse('Perpindahan stage tidak diizinkan'),
    ...commonErrors,
  },
})

const deleteApplicantRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags,
  security,
  summary: 'Hapus pelamar',
  request: { params: IdParamSchema },
  responses: {
    204: { description: 'Pelamar dihapus' },
    400: errorResponse('id bukan UUID'),
    404: errorResponse('Pelamar tidak ditemukan'),
    ...commonErrors,
  },
})

// ---------------------------------------------------------------------------
// Handler. Saat handler berjalan, input SUDAH tervalidasi dan bertipe.
// ---------------------------------------------------------------------------

const notFound = (id: string) => new ApiError(404, 'NOT_FOUND', `Pelamar dengan id ${id} tidak ditemukan`)

export const applicants = new OpenAPIHono<{ Bindings: Env }>({ defaultHook: validationHook })
  .openapi(createApplicantRoute, async (c) => {
    const input = c.req.valid('json')
    try {
      const applicant = await insertApplicant(c.env.DB, input)
      c.header('Location', `/applicants/${applicant.id}`)
      return c.json(applicant, 201)
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', `Email ${input.email} sudah terdaftar`)
      }
      throw err
    }
  })
  .openapi(listApplicantsRoute, async (c) => {
    const query = c.req.valid('query')
    const { data, total } = await listApplicants(c.env.DB, query)
    return c.json({ data, pagination: { total, limit: query.limit, offset: query.offset } }, 200)
  })
  .openapi(getApplicantRoute, async (c) => {
    const { id } = c.req.valid('param')
    const applicant = await findApplicantById(c.env.DB, id)
    if (!applicant) throw notFound(id)
    return c.json(applicant, 200)
  })
  .openapi(updateStageRoute, async (c) => {
    const { id } = c.req.valid('param')
    const { stage: to } = c.req.valid('json')

    const current = await findApplicantById(c.env.DB, id)
    if (!current) throw notFound(id)

    if (!canTransition(current.stage, to)) {
      throw new ApiError(
        422,
        'INVALID_STAGE_TRANSITION',
        `Tidak bisa memindahkan pelamar dari '${current.stage}' ke '${to}'`,
        { from: current.stage, to, allowed: ALLOWED_TRANSITIONS[current.stage] },
      )
    }

    const updated = await updateApplicantStage(c.env.DB, id, current.stage, to)
    if (!updated) {
      throw new ApiError(409, 'STAGE_CONFLICT', 'Stage pelamar baru saja diubah oleh request lain, silakan coba lagi')
    }
    return c.json(updated, 200)
  })
  .openapi(deleteApplicantRoute, async (c) => {
    const { id } = c.req.valid('param')
    const deleted = await deleteApplicant(c.env.DB, id)
    if (!deleted) throw notFound(id)
    return c.body(null, 204)
  })
