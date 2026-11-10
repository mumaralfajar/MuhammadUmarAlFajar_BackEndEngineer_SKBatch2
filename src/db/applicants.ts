import type { Applicant, CreateApplicantInput, ListQuery } from '../schemas/applicant'
import type { Stage } from '../lib/stages'

/** Bentuk baris persis seperti di tabel D1 (snake_case). */
type ApplicantRow = {
  id: string
  full_name: string
  email: string
  phone: string | null
  position: string
  stage: Stage
  created_at: string
  updated_at: string
}

/** Ubah baris DB (snake_case) menjadi objek API (camelCase). */
const toApplicant = (row: ApplicantRow): Applicant => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  position: row.position,
  stage: row.stage,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/** Escape karakter wildcard LIKE (%, _ dan \) agar input user dicari secara literal. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`)

export const isUniqueViolation = (err: unknown) =>
  err instanceof Error && err.message.includes('UNIQUE constraint failed')

/*
 * Semua query memakai prepared statement + .bind().
 * Nilai dari user TIDAK PERNAH digabung ke string SQL, sehingga aman dari SQL injection.
 */

export async function insertApplicant(db: D1Database, input: CreateApplicantInput): Promise<Applicant> {
  const now = new Date().toISOString()
  const row = await db
    .prepare(
      `INSERT INTO applicants (id, full_name, email, phone, position, stage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'applied', ?, ?)
       RETURNING *`,
    )
    .bind(crypto.randomUUID(), input.fullName, input.email, input.phone ?? null, input.position, now, now)
    .first<ApplicantRow>()

  // RETURNING * selalu mengembalikan baris setelah INSERT berhasil
  return toApplicant(row!)
}

export async function findApplicantById(db: D1Database, id: string): Promise<Applicant | null> {
  const row = await db.prepare('SELECT * FROM applicants WHERE id = ?').bind(id).first<ApplicantRow>()
  return row ? toApplicant(row) : null
}

export async function listApplicants(
  db: D1Database,
  query: ListQuery,
): Promise<{ data: Applicant[]; total: number }> {
  const conditions: string[] = []
  const params: unknown[] = []

  if (query.stage) {
    conditions.push('stage = ?')
    params.push(query.stage)
  }
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`
    conditions.push("(full_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')")
    params.push(pattern, pattern)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  // db.batch() mengirim beberapa statement dalam SATU round-trip ke D1.
  const [rows, count] = await db.batch([
    db
      .prepare(`SELECT * FROM applicants ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(...params, query.limit, query.offset),
    db.prepare(`SELECT COUNT(*) AS total FROM applicants ${where}`).bind(...params),
  ])

  return {
    data: (rows.results as ApplicantRow[]).map(toApplicant),
    total: (count.results[0] as { total: number }).total,
  }
}

/**
 * Update stage dengan "optimistic concurrency":
 * baris hanya diubah jika stage-nya MASIH sama dengan `from`.
 * Jika dua request bersamaan mencoba memindahkan pelamar yang sama,
 * hanya satu yang berhasil; yang lain mendapat null.
 */
export async function updateApplicantStage(
  db: D1Database,
  id: string,
  from: Stage,
  to: Stage,
): Promise<Applicant | null> {
  const row = await db
    .prepare('UPDATE applicants SET stage = ?, updated_at = ? WHERE id = ? AND stage = ? RETURNING *')
    .bind(to, new Date().toISOString(), id, from)
    .first<ApplicantRow>()
  return row ? toApplicant(row) : null
}

export async function deleteApplicant(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM applicants WHERE id = ?').bind(id).run()
  return result.meta.changes > 0
}
