import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * Error yang "diharapkan" (validasi, not found, konflik, dll).
 * Dilempar dari handler mana pun, lalu diubah menjadi respons JSON
 * oleh `app.onError` di src/index.ts.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Bentuk tunggal untuk SEMUA respons error. */
export type ErrorBody = {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export const errorBody = (code: string, message: string, details?: unknown): ErrorBody => ({
  error: details === undefined ? { code, message } : { code, message, details },
})
