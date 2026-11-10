import { z } from '@hono/zod-openapi'
import { STAGES } from '../lib/stages'

/*
 * Satu skema Zod dipakai untuk 3 hal sekaligus:
 *   1. Validasi request saat runtime
 *   2. Tipe TypeScript (lewat z.infer)
 *   3. Dokumentasi OpenAPI / Swagger (lewat .openapi())
 */

export const StageSchema = z.enum(STAGES).openapi({ example: 'screening' })

const trimmedText = (field: string, min: number, max: number) =>
  z
    .string({ error: `${field} wajib diisi dan berupa teks` })
    .trim()
    .min(min, { error: `${field} minimal ${min} karakter` })
    .max(max, { error: `${field} maksimal ${max} karakter` })

export const CreateApplicantSchema = z
  .strictObject({
    fullName: trimmedText('fullName', 2, 100).openapi({ example: 'Budi Santoso' }),
    email: z
      .string({ error: 'email wajib diisi' })
      .trim()
      .toLowerCase()
      .max(254, { error: 'email maksimal 254 karakter' })
      .pipe(z.email({ error: 'format email tidak valid' }))
      .openapi({ example: 'budi.santoso@example.com' }),
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, {
        error: 'phone harus berformat E.164, contoh: +6281234567890',
      })
      .optional()
      .openapi({ example: '+6281234567890' }),
    position: trimmedText('position', 2, 100).openapi({ example: 'Backend Engineer' }),
  })
  .openapi('CreateApplicantInput')

export const UpdateStageSchema = z
  .strictObject({
    stage: StageSchema,
  })
  .openapi('UpdateStageInput')

export const ApplicantSchema = z
  .object({
    id: z.uuid().openapi({ example: '3f1c2b8e-9a4d-4c1e-8f2a-1b2c3d4e5f60' }),
    fullName: z.string().openapi({ example: 'Budi Santoso' }),
    email: z.string().openapi({ example: 'budi.santoso@example.com' }),
    phone: z.string().nullable().openapi({ example: '+6281234567890' }),
    position: z.string().openapi({ example: 'Backend Engineer' }),
    stage: StageSchema,
    createdAt: z.string().openapi({ example: '2026-11-10T03:00:00.000Z' }),
    updatedAt: z.string().openapi({ example: '2026-11-10T03:00:00.000Z' }),
  })
  .openapi('Applicant')

export const IdParamSchema = z.object({
  id: z
    .uuid({ error: 'id harus berupa UUID yang valid' })
    .openapi({ param: { name: 'id', in: 'path' }, example: '3f1c2b8e-9a4d-4c1e-8f2a-1b2c3d4e5f60' }),
})

export const ListQuerySchema = z.object({
  stage: StageSchema.optional().openapi({ param: { name: 'stage', in: 'query' } }),
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .openapi({
      param: { name: 'q', in: 'query', description: 'Cari berdasarkan nama atau email' },
      example: 'budi',
    }),
  limit: z.coerce
    .number()
    .int()
    .min(1, { error: 'limit minimal 1' })
    .max(100, { error: 'limit maksimal 100' })
    .default(20)
    .openapi({ param: { name: 'limit', in: 'query' }, example: 20 }),
  offset: z.coerce
    .number()
    .int()
    .min(0, { error: 'offset minimal 0' })
    .default(0)
    .openapi({ param: { name: 'offset', in: 'query' }, example: 0 }),
})

export const ApplicantListSchema = z
  .object({
    data: z.array(ApplicantSchema),
    pagination: z.object({
      total: z.number().int(),
      limit: z.number().int(),
      offset: z.number().int(),
    }),
  })
  .openapi('ApplicantList')

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
      message: z.string().openapi({ example: 'Request tidak valid' }),
      details: z.unknown().optional(),
    }),
  })
  .openapi('Error')

export type CreateApplicantInput = z.infer<typeof CreateApplicantSchema>
export type Applicant = z.infer<typeof ApplicantSchema>
export type ListQuery = z.infer<typeof ListQuerySchema>
