import type { Hook } from '@hono/zod-openapi'
import { errorBody } from './errors'

/**
 * Dipanggil oleh @hono/zod-openapi setelah setiap validasi.
 * Jika gagal, kita kembalikan error 400 dengan format yang seragam
 * (bukan format default Zod), berisi daftar field yang bermasalah.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const validationHook: Hook<any, any, any, any> = (result, c) => {
  if (result.success) return

  const details = result.error.issues.map((issue) => ({
    field: issue.path.join('.') || result.target,
    message: issue.message,
  }))

  return c.json(errorBody('VALIDATION_ERROR', 'Request tidak valid', details), 400)
}
