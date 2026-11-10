import { describe, expect, it } from 'vitest'
import { call, createApplicant, validApplicant } from './helpers'

type ErrorRes = { error: { code: string; message: string; details?: any } }

describe('POST /applicants', () => {
  it('membuat pelamar baru dengan stage awal "applied"', async () => {
    const input = validApplicant({ email: '  Siti.Aminah@Example.COM ', fullName: '  Siti Aminah  ' })
    const res = await call('POST', '/applicants', { body: input })

    expect(res.status).toBe(201)
    const body = (await res.json()) as any
    expect(body).toMatchObject({
      fullName: 'Siti Aminah', // di-trim
      email: 'siti.aminah@example.com', // di-trim + lowercase
      phone: '+6281234567890',
      position: 'Backend Engineer',
      stage: 'applied',
    })
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.headers.get('Location')).toBe(`/applicants/${body.id}`)
  })

  it('phone bersifat opsional', async () => {
    const { phone, ...input } = validApplicant()
    const res = await call('POST', '/applicants', { body: input })
    expect(res.status).toBe(201)
    expect(((await res.json()) as any).phone).toBeNull()
  })

  it.each([
    ['fullName kosong', { fullName: '' }, 'fullName'],
    ['fullName terlalu pendek', { fullName: 'A' }, 'fullName'],
    ['fullName terlalu panjang', { fullName: 'x'.repeat(101) }, 'fullName'],
    ['email tidak valid', { email: 'bukan-email' }, 'email'],
    ['phone bukan E.164', { phone: '0812-3456' }, 'phone'],
    ['position kosong', { position: ' ' }, 'position'],
    ['field tak dikenal', { stage: 'hired' }, ''],
  ])('menolak input: %s', async (_name, override, field) => {
    const res = await call('POST', '/applicants', { body: validApplicant(override) })
    expect(res.status).toBe(400)
    const body = (await res.json()) as ErrorRes
    expect(body.error.code).toBe('VALIDATION_ERROR')
    if (field) expect(body.error.details.map((d: any) => d.field)).toContain(field)
  })

  it('menolak field wajib yang hilang', async () => {
    const res = await call('POST', '/applicants', { body: {} })
    expect(res.status).toBe(400)
    const fields = ((await res.json()) as ErrorRes).error.details.map((d: any) => d.field)
    expect(fields).toEqual(expect.arrayContaining(['fullName', 'email', 'position']))
  })

  it('menolak body yang bukan JSON valid', async () => {
    const res = await call('POST', '/applicants', { rawBody: '{ rusak' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ErrorRes).error.code).toBe('INVALID_JSON')
  })

  it('menolak email duplikat (tidak peka huruf besar/kecil) dengan 409', async () => {
    const created = await createApplicant()
    const res = await call('POST', '/applicants', { body: validApplicant({ email: created.email.toUpperCase() }) })
    expect(res.status).toBe(409)
    expect(((await res.json()) as ErrorRes).error.code).toBe('EMAIL_ALREADY_EXISTS')
  })
})

describe('GET /applicants', () => {
  it('mengembalikan daftar dengan paginasi', async () => {
    await createApplicant()
    await createApplicant()
    const res = await call('GET', '/applicants?limit=1&offset=0')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.data).toHaveLength(1)
    expect(body.pagination.limit).toBe(1)
    expect(body.pagination.offset).toBe(0)
    expect(body.pagination.total).toBeGreaterThanOrEqual(2)
  })

  it('memfilter berdasarkan stage', async () => {
    const a = await createApplicant()
    await call('PATCH', `/applicants/${a.id}/stage`, { body: { stage: 'screening' } })
    const res = await call('GET', '/applicants?stage=screening&limit=100')
    const body = (await res.json()) as any
    expect(body.data.length).toBeGreaterThanOrEqual(1)
    expect(body.data.every((x: any) => x.stage === 'screening')).toBe(true)
    expect(body.data.map((x: any) => x.id)).toContain(a.id)
  })

  it('mencari berdasarkan nama/email dan memperlakukan % secara literal', async () => {
    const a = await createApplicant({ fullName: 'Rahmat Hidayat Unik' })
    const res = await call('GET', '/applicants?q=hidayat%20unik')
    const body = (await res.json()) as any
    expect(body.data.map((x: any) => x.id)).toContain(a.id)

    const wildcard = await call('GET', `/applicants?q=${encodeURIComponent('%')}`)
    expect(((await wildcard.json()) as any).data).toHaveLength(0)
  })

  it.each([['limit=0'], ['limit=101'], ['limit=abc'], ['offset=-1'], ['stage=unknown']])(
    'menolak query tidak valid: %s',
    async (qs) => {
      const res = await call('GET', `/applicants?${qs}`)
      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorRes).error.code).toBe('VALIDATION_ERROR')
    },
  )
})

describe('GET /applicants/{id}', () => {
  it('mengembalikan detail pelamar', async () => {
    const a = await createApplicant()
    const res = await call('GET', `/applicants/${a.id}`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).id).toBe(a.id)
  })

  it('404 untuk id yang tidak ada', async () => {
    const res = await call('GET', `/applicants/${crypto.randomUUID()}`)
    expect(res.status).toBe(404)
    expect(((await res.json()) as ErrorRes).error.code).toBe('NOT_FOUND')
  })

  it('400 untuk id yang bukan UUID', async () => {
    const res = await call('GET', '/applicants/123')
    expect(res.status).toBe(400)
  })
})

describe('PATCH /applicants/{id}/stage', () => {
  it('memindahkan pelamar sepanjang pipeline sampai hired', async () => {
    const a = await createApplicant()
    for (const stage of ['screening', 'interview', 'offer', 'hired']) {
      const res = await call('PATCH', `/applicants/${a.id}/stage`, { body: { stage } })
      expect(res.status).toBe(200)
      expect(((await res.json()) as any).stage).toBe(stage)
    }
  })

  it('mengizinkan reject dari stage aktif', async () => {
    const a = await createApplicant()
    const res = await call('PATCH', `/applicants/${a.id}/stage`, { body: { stage: 'rejected' } })
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).stage).toBe('rejected')
  })

  it.each([
    ['melompati stage', [], 'offer'],
    ['mundur', ['screening'], 'applied'],
    ['stage yang sama', [], 'applied'],
    ['keluar dari hired', ['screening', 'interview', 'offer', 'hired'], 'rejected'],
    ['keluar dari rejected', ['rejected'], 'screening'],
  ])('422 untuk perpindahan ilegal: %s', async (_name, path, target) => {
    const a = await createApplicant()
    for (const stage of path) await call('PATCH', `/applicants/${a.id}/stage`, { body: { stage } })

    const res = await call('PATCH', `/applicants/${a.id}/stage`, { body: { stage: target } })
    expect(res.status).toBe(422)
    const body = (await res.json()) as ErrorRes
    expect(body.error.code).toBe('INVALID_STAGE_TRANSITION')
    expect(body.error.details).toHaveProperty('allowed')
  })

  it('400 untuk stage yang tidak dikenal', async () => {
    const a = await createApplicant()
    const res = await call('PATCH', `/applicants/${a.id}/stage`, { body: { stage: 'promoted' } })
    expect(res.status).toBe(400)
  })

  it('404 untuk pelamar yang tidak ada', async () => {
    const res = await call('PATCH', `/applicants/${crypto.randomUUID()}/stage`, { body: { stage: 'screening' } })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /applicants/{id}', () => {
  it('menghapus pelamar lalu 404 saat diambil lagi', async () => {
    const a = await createApplicant()
    const del = await call('DELETE', `/applicants/${a.id}`)
    expect(del.status).toBe(204)
    expect(await del.text()).toBe('')

    expect((await call('GET', `/applicants/${a.id}`)).status).toBe(404)
    expect((await call('DELETE', `/applicants/${a.id}`)).status).toBe(404)
  })
})
