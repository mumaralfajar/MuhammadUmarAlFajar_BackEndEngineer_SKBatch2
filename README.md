# Sekolah Karir — Applicant API

API kecil untuk mengelola data **pelamar (applicant)**: membuat, menampilkan daftar, melihat detail, memindahkan *stage* rekrutmen, dan menghapus pelamar. Dibangun dengan **Hono + Cloudflare Workers + D1 (Serverless SQLite)**, dilengkapi validasi input, autentikasi API key, rate limiting, dokumentasi Swagger, dan test otomatis.

README ini sengaja ditulis panjang. Tujuannya dua: menjelaskan cara memakai project ini, **dan** menjadi bahan belajar lengkap tentang ketiga teknologi tersebut, memakai kode di repo ini sebagai contoh nyata.

---

## Daftar Isi

1. [Gambaran Singkat](#1-gambaran-singkat)
2. [Mengenal Teknologinya](#2-mengenal-teknologinya)
3. [Quick Start (Menjalankan Secara Lokal)](#3-quick-start-menjalankan-secara-lokal)
4. [Struktur Project](#4-struktur-project)
5. [Alur Sebuah Request](#5-alur-sebuah-request)
6. [Belajar Hono Lewat Kode Ini](#6-belajar-hono-lewat-kode-ini)
7. [Belajar Cloudflare Workers Lewat Kode Ini](#7-belajar-cloudflare-workers-lewat-kode-ini)
8. [Belajar D1 Lewat Kode Ini](#8-belajar-d1-lewat-kode-ini)
9. [Validasi Input](#9-validasi-input)
10. [Aturan Perpindahan Stage](#10-aturan-perpindahan-stage)
11. [Autentikasi](#11-autentikasi)
12. [Rate Limiting](#12-rate-limiting)
13. [Dokumentasi Swagger / OpenAPI](#13-dokumentasi-swagger--openapi)
14. [Referensi API + Contoh `curl`](#14-referensi-api--contoh-curl)
15. [Testing](#15-testing)
16. [Deploy ke Cloudflare](#16-deploy-ke-cloudflare)
17. [Batas Free Tier yang Perlu Diketahui](#17-batas-free-tier-yang-perlu-diketahui)
18. [Troubleshooting](#18-troubleshooting)
19. [Langkah Belajar Selanjutnya](#19-langkah-belajar-selanjutnya)

---

## 1. Gambaran Singkat

| Endpoint | Fungsi | Auth |
|---|---|---|
| `POST /applicants` | Membuat pelamar baru (stage awal `applied`) | ✅ |
| `GET /applicants` | Daftar pelamar + filter `stage`, pencarian `q`, paginasi | ✅ |
| `GET /applicants/{id}` | Detail satu pelamar | ✅ |
| `PATCH /applicants/{id}/stage` | Memindahkan stage pelamar | ✅ |
| `DELETE /applicants/{id}` | Menghapus pelamar | ✅ |
| `GET /docs` | Swagger UI (dokumentasi interaktif) | — |
| `GET /openapi.json` | Spesifikasi OpenAPI 3.1 | — |
| `GET /health` | Health check | — |

Semua endpoint `/applicants` dilindungi **API key** dan **rate limit** (60 request/menit per IP).

---

## 2. Mengenal Teknologinya

### 2.1 Cloudflare Workers — *tempat kode berjalan*

Cloudflare Workers adalah platform **serverless** yang menjalankan kode JavaScript/TypeScript di ratusan data center Cloudflare di seluruh dunia (*edge*). Bedanya dengan server biasa:

| Server tradisional (mis. Express di VPS) | Cloudflare Workers |
|---|---|
| Kamu menyewa & merawat server | Tidak ada server yang dikelola |
| Berjalan di satu lokasi | Berjalan di lokasi terdekat dengan pengguna |
| Proses Node.js hidup terus | **Isolate** V8 kecil yang dibuat per kebutuhan, *cold start* hampir nol |
| Akses penuh ke filesystem, `process`, dll. | Hanya **Web Standard API** (`fetch`, `Request`, `Response`, `crypto`, …) |
| Koneksi DB lewat host/port | Sumber daya dihubungkan lewat **binding** (`env.DB`, dll.) |

Sebuah Worker pada dasarnya hanyalah objek dengan fungsi `fetch`:

```ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response('Halo dari edge!')
  },
}
```

- `request` — request HTTP masuk (objek `Request` standar web).
- `env` — semua **binding**: database D1, rate limiter, secret, variabel.
- `ctx` — utilitas runtime, mis. `ctx.waitUntil()` untuk pekerjaan setelah respons dikirim.

Di project ini, objek tersebut adalah `app` milik Hono (`export default app` di [`src/index.ts`](src/index.ts)) karena aplikasi Hono memiliki method `fetch` dengan signature yang sama.

**Wrangler** adalah CLI resmi untuk Workers: menjalankan dev server lokal (`wrangler dev`), mengelola D1, menyimpan secret, dan deploy.

### 2.2 Hono — *framework web-nya*

[Hono](https://hono.dev) (bahasa Jepang: "api") adalah framework web yang sangat kecil dan cepat, dibangun di atas Web Standard API. Karena itu ia berjalan di mana saja: Workers, Deno, Bun, Node.js, dll. Kalau kamu pernah memakai Express, Hono akan terasa familier:

```ts
import { Hono } from 'hono'

const app = new Hono()
app.get('/halo/:nama', (c) => c.json({ pesan: `Halo, ${c.req.param('nama')}!` }))

export default app
```

Keunggulan Hono untuk Workers:
- **Typed bindings**: `new Hono<{ Bindings: Env }>()` membuat `c.env.DB` bertipe `D1Database`.
- **Middleware** dengan pola `await next()` (gaya "onion").
- Ekosistem resmi: `@hono/zod-openapi` (validasi + OpenAPI), `@hono/swagger-ui`, dan middleware bawaan (`logger`, `secureHeaders`, `cors`, dll.).
- Testing mudah: `app.request('/path')` tanpa perlu menjalankan server.

### 2.3 D1 — *database-nya*

D1 adalah database **SQLite serverless** milik Cloudflare:
- Kamu menulis SQL biasa (dialek SQLite).
- Tidak ada connection string, pool, atau password. Worker mengaksesnya lewat binding `env.DB`.
- Skema dikelola dengan **migration** (file `.sql` bernomor).
- Wrangler menyediakan database **lokal** (file SQLite di `.wrangler/state`) untuk development, dan database **remote** di Cloudflare untuk produksi.

Bagaimana ketiganya terhubung:

```
            ┌──────────────── Cloudflare Edge ────────────────┐
 Client ──► │  Worker (isolate V8)                            │
  (HTTP)    │   └─ Hono app                                   │
            │       ├─ middleware: logger, secureHeaders      │
            │       ├─ middleware: rateLimit ──► RATE_LIMITER │ (binding)
            │       ├─ middleware: requireApiKey ◄─ API_KEY   │ (secret)
            │       ├─ validasi Zod (otomatis dari route)     │
            │       └─ handler ──► env.DB ──────────► D1      │ (binding, SQLite)
            └─────────────────────────────────────────────────┘
```

---

## 3. Quick Start (Menjalankan Secara Lokal)

**Prasyarat:** Node.js 20+ dan npm. Tidak perlu akun Cloudflare untuk development lokal.

```bash
git clone https://github.com/mumaralfajar/MuhammadUmarAlFajar_BackEndEngineer_SKBatch2.git
cd MuhammadUmarAlFajar_BackEndEngineer_SKBatch2
npm install
```

Buat file secret lokal dari contoh (isi `API_KEY` sesukamu):

```bash
cp .dev.vars.example .dev.vars
```

Buat tabel di database D1 lokal:

```bash
npm run db:migrate:local
```

Jalankan dev server:

```bash
npm run dev
```

Buka **http://localhost:8787/docs**, klik **Authorize**, isi dengan nilai `API_KEY` dari `.dev.vars`, lalu coba semua endpoint langsung dari browser.

Perintah lain:

| Perintah | Fungsi |
|---|---|
| `npm test` | Menjalankan semua test di runtime Workers |
| `npm run typecheck` | Cek tipe TypeScript |
| `npm run cf-typegen` | Generate ulang tipe `Env` dari `wrangler.jsonc` |
| `npm run db:migrate:remote` | Terapkan migration ke D1 produksi |
| `npm run deploy` | Deploy ke Cloudflare |

> **Catatan Windows:** npm versi baru memblokir *install script* secara default. Jika `wrangler` gagal berjalan setelah `npm install`, jalankan `npm install-scripts approve workerd esbuild` lalu `npm rebuild`.

---

## 4. Struktur Project

```
.
├── migrations/
│   └── 0001_create_applicants.sql   # Skema tabel D1
├── src/
│   ├── index.ts                     # Entry point Worker: app Hono, middleware, Swagger, error handler
│   ├── routes/applicants.ts         # Definisi route OpenAPI + handler
│   ├── schemas/applicant.ts         # Skema Zod (validasi + tipe + dokumentasi)
│   ├── db/applicants.ts             # Semua query D1 (prepared statement)
│   ├── middleware/
│   │   ├── auth.ts                  # Autentikasi Bearer API key
│   │   └── rate-limit.ts            # Rate limit per IP
│   └── lib/
│       ├── errors.ts                # ApiError + format error seragam
│       ├── stages.ts                # State machine stage rekrutmen
│       └── validation.ts            # Hook untuk merapikan error validasi
├── test/
│   ├── apply-migrations.ts          # Setup: jalankan migration sebelum test
│   ├── helpers.ts                   # Helper request untuk test
│   ├── applicants.test.ts           # Test CRUD + validasi + stage
│   └── security.test.ts             # Test auth, rate limit, OpenAPI
├── wrangler.jsonc                   # Konfigurasi Worker + binding D1 & rate limiter
├── worker-configuration.d.ts        # Tipe Env hasil `wrangler types` (jangan diedit manual)
├── vitest.config.ts                 # Konfigurasi test (runtime Workers)
└── .dev.vars.example                # Contoh secret lokal
```

Prinsip pembagiannya: **route** hanya mengurus HTTP, **db** hanya mengurus SQL, **schemas** hanya mengurus bentuk data, dan **lib** berisi logika murni yang mudah dites.

---

## 5. Alur Sebuah Request

Misalnya `PATCH /applicants/{id}/stage` dengan body `{"stage":"interview"}`:

1. **Cloudflare** menerima request di data center terdekat, lalu memanggil `fetch` milik Worker → `app.fetch` milik Hono.
2. **`logger()`** mencatat request; **`secureHeaders()`** akan menambahkan header keamanan ke respons.
3. **`rateLimit`** memanggil `env.RATE_LIMITER.limit({ key: 'ip:...' })`. Jika kuota habis → **429**.
4. **`requireApiKey`** memeriksa header `Authorization: Bearer ...`. Jika salah → **401**.
5. Router Hono mencocokkan path ke `updateStageRoute`. **`@hono/zod-openapi`** memvalidasi `id` (harus UUID) dan body (`stage` harus salah satu enum). Jika gagal → `validationHook` → **400**.
6. **Handler** mengambil data pelamar dari D1. Jika tidak ada → **404**. Jika perpindahan dilarang → **422**.
7. `UPDATE ... WHERE id = ? AND stage = ?` dijalankan. Jika ada request lain yang lebih dulu mengubahnya → **409**.
8. Respons JSON **200** dikembalikan.

Setiap error di langkah mana pun dilempar sebagai `ApiError` dan diubah oleh **`app.onError`** menjadi format yang sama:

```json
{ "error": { "code": "INVALID_STAGE_TRANSITION", "message": "...", "details": { ... } } }
```

---

## 6. Belajar Hono Lewat Kode Ini

### 6.1 Membuat app dengan tipe binding

```ts
// src/index.ts
const app = new OpenAPIHono<{ Bindings: Env }>({ defaultHook: validationHook })
```

`OpenAPIHono` adalah `Hono` biasa plus kemampuan OpenAPI. Generic `{ Bindings: Env }` membuat `c.env` bertipe lengkap. Tipe `Env` dibuat otomatis oleh `npx wrangler types` dari `wrangler.jsonc` (lihat `worker-configuration.d.ts`).

### 6.2 Context `c`

Setiap handler dan middleware menerima `c` (Context):

| API | Kegunaan |
|---|---|
| `c.req.param('id')`, `c.req.query('q')`, `c.req.header('X')` | Baca data request mentah |
| `c.req.valid('json' \| 'query' \| 'param')` | Baca data yang **sudah divalidasi Zod** dan bertipe |
| `c.env.DB` | Akses binding |
| `c.json(data, status)` | Respons JSON |
| `c.body(null, 204)` | Respons tanpa body |
| `c.header('Location', '...')` | Set header respons |
| `c.redirect('/docs')` | Redirect |

### 6.3 Middleware

Middleware adalah fungsi `(c, next) => ...`. Kode sebelum `await next()` jalan **sebelum** handler; kode setelahnya jalan **sesudah** handler. Jika middleware melempar error atau tidak memanggil `next()`, rantai berhenti.

```ts
// src/middleware/auth.ts
export const requireApiKey = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  // ... cek header; jika salah: throw new ApiError(401, ...)
  await next()
})
```

Pemasangannya:

```ts
app.use('*', logger())                                   // semua route
app.use('/applicants/*', rateLimit, requireApiKey)       // hanya route /applicants
```

> **Jebakan yang sempat terjadi di project ini:** di Hono, pola `'/applicants/*'` **juga** cocok dengan `'/applicants'`. Awalnya kode ini mendaftarkan `app.use('/applicants', ...)` juga, sehingga rate limiter terpanggil **dua kali** per request dan kuota efektif hanya 30/menit. Test rate limit yang menangkap bug ini.

### 6.4 Sub-app dan `app.route()`

Route pelamar dibuat sebagai app terpisah di `src/routes/applicants.ts`, lalu dipasang di prefix `/applicants`:

```ts
app.route('/applicants', applicants)
```

Di dalam sub-app, path ditulis relatif (`'/'`, `'/{id}'`, `'/{id}/stage'`).

### 6.5 Route bertipe dengan `createRoute`

```ts
const getApplicantRoute = createRoute({
  method: 'get',
  path: '/{id}',                       // sintaks OpenAPI {id}, bukan :id
  request: { params: IdParamSchema },  // apa yang divalidasi
  responses: { 200: { ... }, 404: { ... } },  // apa yang didokumentasikan
})

applicants.openapi(getApplicantRoute, async (c) => {
  const { id } = c.req.valid('param')  // sudah pasti UUID valid
  ...
})
```

Satu definisi ini menghasilkan **validasi runtime**, **tipe TypeScript**, dan **dokumentasi Swagger** sekaligus, sehingga dokumentasi tidak bisa "basi" dibanding kode.

### 6.6 Error handling terpusat

```ts
app.onError((err, c) => {
  if (err instanceof ApiError) return c.json(errorBody(err.code, err.message, err.details), err.status)
  if (err instanceof HTTPException) ...   // error bawaan Hono, mis. JSON rusak
  return c.json(errorBody('INTERNAL_ERROR', '...'), 500)  // jangan bocorkan detail internal
})
app.notFound((c) => c.json(errorBody('ROUTE_NOT_FOUND', '...'), 404))
```

Handler cukup `throw new ApiError(404, 'NOT_FOUND', '...')` tanpa perlu menyusun respons error sendiri.

---

## 7. Belajar Cloudflare Workers Lewat Kode Ini

### 7.1 `wrangler.jsonc`

```jsonc
{
  "name": "sekolah-karir-api",          // nama Worker → URL: sekolah-karir-api.<subdomain>.workers.dev
  "main": "src/index.ts",               // entry point (Wrangler mem-bundle TypeScript otomatis)
  "compatibility_date": "2026-11-01",   // "versi" perilaku runtime yang dipakai
  "observability": { "enabled": true }, // log bisa dilihat di dashboard
  "d1_databases": [ ... ],              // binding DB
  "ratelimits": [ ... ]                 // binding RATE_LIMITER
}
```

- **`compatibility_date`** mengunci perilaku runtime. Cloudflare tidak akan mengubah perilaku Worker-mu secara diam-diam. Naikkan tanggalnya secara sadar saat ingin fitur baru.
- **Binding** adalah cara Worker "terhubung" ke sumber daya lain. Tidak ada URL atau password di kode; cukup `env.NAMA_BINDING`.

### 7.2 Secret vs variabel

| Jenis | Contoh | Lokal | Produksi |
|---|---|---|---|
| Secret (rahasia) | `API_KEY` | file `.dev.vars` (di-*gitignore*) | `npx wrangler secret put API_KEY` |
| Variabel biasa | (tidak dipakai di sini) | `"vars"` di `wrangler.jsonc` | sama |

Secret **tidak pernah** ditulis di `wrangler.jsonc` atau di-commit ke git.

### 7.3 Web Standard API

Karena Workers bukan Node.js, kode ini hanya memakai API standar web:
- `crypto.randomUUID()` untuk membuat ID pelamar.
- `crypto.subtle.digest()` dan **`crypto.subtle.timingSafeEqual()`** (ekstensi khusus Workers) untuk membandingkan API key secara aman.
- `new Date().toISOString()` untuk timestamp.

### 7.4 Tipe otomatis

```bash
npm run cf-typegen   # = npx wrangler types
```

Perintah ini membaca `wrangler.jsonc` dan `.dev.vars`, lalu menulis `worker-configuration.d.ts` berisi interface `Env` (`DB: D1Database`, `RATE_LIMITER: RateLimit`, `API_KEY: string`) dan semua tipe runtime Workers. **Jalankan ulang setiap kali mengubah binding.**

### 7.5 Development lokal

`wrangler dev` menjalankan Worker di **workerd** (runtime yang sama dengan produksi) lewat **Miniflare**. D1 dan rate limiter juga disimulasikan secara lokal, jadi kamu bisa develop sepenuhnya offline.

---

## 8. Belajar D1 Lewat Kode Ini

### 8.1 Binding

```jsonc
"d1_databases": [{
  "binding": "DB",                      // nama di kode: c.env.DB
  "database_name": "sekolah-karir-db",  // nama di Cloudflare / perintah wrangler
  "database_id": "...",                 // ID unik dari `wrangler d1 create`
  "migrations_dir": "migrations"
}]
```

### 8.2 Migration

Skema database dikelola dengan file SQL bernomor di folder `migrations/`. Wrangler mencatat migration mana yang sudah diterapkan di tabel `d1_migrations`.

```bash
npx wrangler d1 migrations create sekolah-karir-db add_notes_column  # membuat file migration baru
npx wrangler d1 migrations list   sekolah-karir-db --local           # melihat status
npx wrangler d1 migrations apply  sekolah-karir-db --local           # terapkan ke DB lokal
npx wrangler d1 migrations apply  sekolah-karir-db --remote          # terapkan ke DB produksi
```

**Aturan emas:** jangan pernah mengedit migration yang sudah diterapkan di produksi. Buat migration baru.

Skema di [`migrations/0001_create_applicants.sql`](migrations/0001_create_applicants.sql) menunjukkan beberapa fitur SQLite:
- `TEXT PRIMARY KEY` untuk UUID.
- `UNIQUE COLLATE NOCASE` agar `Budi@x.com` dan `budi@x.com` dianggap sama (pertahanan kedua; aplikasi juga sudah me-*lowercase* email).
- `CHECK (stage IN (...))`, yaitu validasi di level database sebagai jaring pengaman terakhir.
- Index pada `stage` dan `created_at` untuk filter dan pengurutan.
- SQLite tidak punya tipe `DATETIME` asli, jadi timestamp disimpan sebagai teks ISO 8601 (bisa diurutkan secara leksikografis).

### 8.3 Query API D1

Semua query ada di [`src/db/applicants.ts`](src/db/applicants.ts):

```ts
// .first<T>() → satu baris (atau null)
const row = await db.prepare('SELECT * FROM applicants WHERE id = ?').bind(id).first<ApplicantRow>()

// .run() → untuk INSERT/UPDATE/DELETE; meta.changes = jumlah baris terdampak
const result = await db.prepare('DELETE FROM applicants WHERE id = ?').bind(id).run()
result.meta.changes > 0

// .all() → banyak baris di result.results
const { results } = await db.prepare('SELECT * FROM applicants').all<ApplicantRow>()

// db.batch([...]) → beberapa statement dalam SATU round-trip, dijalankan secara transaksional
const [rows, count] = await db.batch([stmtSelect, stmtCount])
```

### 8.4 Prepared statement = aman dari SQL injection

```ts
// ❌ JANGAN: nilai user digabung ke string SQL
db.prepare(`SELECT * FROM applicants WHERE email = '${email}'`)

// ✅ LAKUKAN: placeholder ? + .bind()
db.prepare('SELECT * FROM applicants WHERE email = ?').bind(email)
```

Untuk query dinamis (filter opsional), kode ini menyusun **potongan SQL yang tetap** (`'stage = ?'`) dan **daftar parameter** secara terpisah. Nilai dari user tidak pernah masuk ke string SQL.

Pencarian `LIKE` juga meng-*escape* karakter `%`, `_`, dan `\` agar input `%` dicari secara literal, bukan sebagai wildcard "semua".

### 8.5 `RETURNING *`

SQLite (dan D1) mendukung `RETURNING`, sehingga `INSERT`/`UPDATE` langsung mengembalikan baris hasil tanpa query `SELECT` tambahan. Ini menghemat satu round-trip.

### 8.6 Optimistic concurrency

```sql
UPDATE applicants SET stage = ?, updated_at = ? WHERE id = ? AND stage = ? RETURNING *
```

Klausa `AND stage = ?` (stage yang terakhir dibaca) memastikan update hanya terjadi jika belum ada yang mengubah stage di antara waktu *baca* dan *tulis*. Jika dua recruiter memindahkan pelamar yang sama bersamaan, satu berhasil dan satu mendapat **409 STAGE_CONFLICT**, tanpa perlu lock.

### 8.7 snake_case ↔ camelCase

Kolom database memakai `snake_case` (konvensi SQL), sedangkan JSON API memakai `camelCase` (konvensi JavaScript). Fungsi `toApplicant()` menjadi satu-satunya tempat konversi.

### 8.8 Lokal vs remote

| | Lokal (`--local`) | Remote (`--remote`) |
|---|---|---|
| Lokasi | `.wrangler/state/v3/d1/` (file SQLite) | Cloudflare |
| Dipakai oleh | `wrangler dev`, `npm test` | Worker yang sudah di-deploy |
| Butuh login? | Tidak | Ya (`wrangler login`) |

Menjalankan SQL langsung:

```bash
npx wrangler d1 execute sekolah-karir-db --local --command "SELECT stage, COUNT(*) FROM applicants GROUP BY stage"
```

---

## 9. Validasi Input

Validasi memakai **Zod** lewat `@hono/zod-openapi` ([`src/schemas/applicant.ts`](src/schemas/applicant.ts)).

### Membuat pelamar (`POST /applicants`)

| Field | Wajib | Aturan |
|---|---|---|
| `fullName` | ✅ | teks, di-*trim*, 2–100 karakter |
| `email` | ✅ | format email valid, maks. 254 karakter, di-*trim* dan di-*lowercase*, harus unik |
| `phone` | — | format **E.164**: `+` diikuti 8–15 digit, mis. `+6281234567890` |
| `position` | ✅ | teks, di-*trim*, 2–100 karakter |

- Skema memakai `z.strictObject`, sehingga **field tak dikenal ditolak**. Klien tidak bisa menyelipkan `"stage": "hired"` saat membuat pelamar.
- `stage` tidak bisa diisi saat create; selalu dimulai dari `applied`.

### Query daftar (`GET /applicants`)

| Param | Aturan | Default |
|---|---|---|
| `stage` | salah satu stage yang valid | — |
| `q` | 1–100 karakter, mencari di nama & email | — |
| `limit` | bilangan bulat 1–100 | 20 |
| `offset` | bilangan bulat ≥ 0 | 0 |

`z.coerce.number()` mengubah string query (`"20"`) menjadi angka sebelum divalidasi.

### Path param

`{id}` harus berupa UUID valid. `GET /applicants/123` → 400, bukan query sia-sia ke database.

### Format error validasi

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request tidak valid",
    "details": [
      { "field": "fullName", "message": "fullName minimal 2 karakter" },
      { "field": "email", "message": "format email tidak valid" }
    ]
  }
}
```

Format ini dibuat oleh `validationHook` di [`src/lib/validation.ts`](src/lib/validation.ts), yang menggantikan format bawaan Zod yang lebih "mentah".

### Lapisan validasi

1. **Zod**: bentuk & format data (400).
2. **Logika bisnis**: aturan stage (422), keberadaan data (404).
3. **Database**: `UNIQUE`, `NOT NULL`, `CHECK` sebagai jaring pengaman terakhir (409 untuk email duplikat).

---

## 10. Aturan Perpindahan Stage

```
applied ──► screening ──► interview ──► offer ──► hired
   │            │             │           │
   └────────────┴─────────────┴───────────┴──────► rejected
```

- Pipeline hanya boleh **maju satu langkah**.
- Semua stage aktif boleh ke **`rejected`**.
- **`hired`** dan **`rejected`** adalah stage akhir dan tidak bisa dipindah lagi.
- Pindah ke stage yang sama juga ditolak.

Perpindahan ilegal menghasilkan **422** beserta daftar stage yang diizinkan:

```json
{
  "error": {
    "code": "INVALID_STAGE_TRANSITION",
    "message": "Tidak bisa memindahkan pelamar dari 'screening' ke 'hired'",
    "details": { "from": "screening", "to": "hired", "allowed": ["interview", "rejected"] }
  }
}
```

Aturannya didefinisikan sebagai tabel di [`src/lib/stages.ts`](src/lib/stages.ts), sehingga mudah diubah tanpa menyentuh handler.

---

## 11. Autentikasi

Semua endpoint `/applicants` membutuhkan header:

```
Authorization: Bearer <API_KEY>
```

Implementasi ([`src/middleware/auth.ts`](src/middleware/auth.ts)):
- `API_KEY` disimpan sebagai **secret** Worker, bukan di kode.
- Perbandingan key memakai **`crypto.subtle.timingSafeEqual`** setelah kedua nilai di-hash SHA-256. Ini mencegah *timing attack*, yaitu menebak key karakter demi karakter dari selisih waktu respons.
- **Fail closed**: jika `API_KEY` lupa dipasang di server, semua request ditolak (500), bukan malah dibiarkan terbuka.
- Respons 401 menyertakan header `WWW-Authenticate: Bearer` sesuai standar HTTP.

> Ini adalah autentikasi **service-to-service** sederhana (satu key bersama). Untuk banyak pengguna dengan peran berbeda, langkah berikutnya adalah JWT atau Cloudflare Access (lihat [bagian 19](#19-langkah-belajar-selanjutnya)).

---

## 12. Rate Limiting

Karena project ini memakai **free tier** Cloudflare, rate limit melindungi kuota (request Worker & operasi D1) dari spam atau penyalahgunaan.

```jsonc
// wrangler.jsonc
"ratelimits": [{
  "name": "RATE_LIMITER",
  "namespace_id": "1001",
  "simple": { "limit": 60, "period": 60 }   // 60 request per 60 detik
}]
```

```ts
// src/middleware/rate-limit.ts
const { success } = await c.env.RATE_LIMITER.limit({ key: `ip:${ip}` })
if (!success) throw new ApiError(429, 'RATE_LIMITED', '...')   // + header Retry-After: 60
```

**Kenapa memakai binding Rate Limiting bawaan Workers, bukan menghitung sendiri di D1/KV?**
- Tersedia di free plan dan **tidak memakai kuota tulis D1/KV**. Menghitung request di D1 berarti *setiap* request memakan 1 operasi tulis (free tier: 100.000 tulis/hari), dan KV hanya 1.000 tulis/hari.
- Counter disimpan di memori data center Cloudflare, sehingga sangat cepat.

**Hal yang perlu dipahami:**
- `period` hanya boleh **10** atau **60** detik.
- Counter bersifat **per lokasi** dan *eventually consistent*: angkanya mendekati, bukan presisi absolut. Cocok untuk mencegah abuse, bukan untuk kuota billing yang harus tepat.
- Key dibuat dari header `CF-Connecting-IP` (IP asli klien yang diisi oleh Cloudflare).
- Rate limit dipasang **sebelum** autentikasi, sehingga percobaan menebak API key juga ikut dibatasi.
- `/health` dan `/docs` tidak dibatasi.

Ubah batasnya cukup di `wrangler.jsonc`, tanpa menyentuh kode.

---

## 13. Dokumentasi Swagger / OpenAPI

- **Swagger UI:** `http://localhost:8787/docs`
- **Spesifikasi mentah:** `http://localhost:8787/openapi.json` (bisa diimpor ke Postman, Insomnia, atau generator SDK)

Cara kerjanya:
1. Setiap skema Zod diberi metadata `.openapi({ example: ... })` dan nama komponen (`.openapi('Applicant')`).
2. Setiap route dibuat dengan `createRoute({...})` yang mendeskripsikan request & semua kemungkinan respons.
3. `app.doc31('/openapi.json', {...})` menyusun dokumen OpenAPI 3.1 dari semua route yang terdaftar.
4. Skema keamanan `bearerAuth` didaftarkan lewat `app.openAPIRegistry.registerComponent(...)`, sehingga tombol **Authorize** muncul di Swagger UI.
5. `swaggerUI({ url: '/openapi.json' })` dari `@hono/swagger-ui` menyajikan halaman Swagger.

Karena dokumentasi dihasilkan dari kode yang sama dengan validasi, **dokumentasi selalu sinkron dengan perilaku API**.

---

## 14. Referensi API + Contoh `curl`

Contoh di bawah memakai bash. Set variabel terlebih dulu:

```bash
export BASE=http://localhost:8787
export KEY=dev-secret-key-change-me
```

### Membuat pelamar

```bash
curl -X POST "$BASE/applicants" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Budi Santoso","email":"budi@example.com","phone":"+6281234567890","position":"Backend Engineer"}'
```

**201 Created** (+ header `Location: /applicants/<id>`):

```json
{
  "id": "750d51fc-83c4-4e37-80e5-46b007a74974",
  "fullName": "Budi Santoso",
  "email": "budi@example.com",
  "phone": "+6281234567890",
  "position": "Backend Engineer",
  "stage": "applied",
  "createdAt": "2026-11-10T03:13:41.570Z",
  "updatedAt": "2026-11-10T03:13:41.570Z"
}
```

### Daftar pelamar

```bash
curl "$BASE/applicants?stage=screening&q=budi&limit=10&offset=0" -H "Authorization: Bearer $KEY"
```

**200 OK:**

```json
{
  "data": [ { "id": "...", "fullName": "Budi Santoso", "stage": "screening", "...": "..." } ],
  "pagination": { "total": 1, "limit": 10, "offset": 0 }
}
```

Hasil diurutkan dari yang terbaru (`createdAt` menurun).

### Detail pelamar

```bash
curl "$BASE/applicants/<id>" -H "Authorization: Bearer $KEY"
```

### Mengubah stage

```bash
curl -X PATCH "$BASE/applicants/<id>/stage" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"stage":"screening"}'
```

### Menghapus pelamar

```bash
curl -X DELETE "$BASE/applicants/<id>" -H "Authorization: Bearer $KEY"
```

**204 No Content** (tanpa body).

### Daftar kode error

| Status | `code` | Kapan |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body/query/param tidak lolos validasi |
| 400 | `INVALID_JSON` | Body bukan JSON valid |
| 401 | `UNAUTHORIZED` | Header Authorization tidak ada / API key salah |
| 404 | `NOT_FOUND` | Pelamar dengan `id` tersebut tidak ada |
| 404 | `ROUTE_NOT_FOUND` | Path/method tidak dikenal |
| 409 | `EMAIL_ALREADY_EXISTS` | Email sudah dipakai pelamar lain |
| 409 | `STAGE_CONFLICT` | Stage diubah oleh request lain secara bersamaan |
| 422 | `INVALID_STAGE_TRANSITION` | Perpindahan stage tidak diizinkan |
| 429 | `RATE_LIMITED` | Melewati 60 request/menit |
| 500 | `INTERNAL_ERROR` / `SERVER_MISCONFIGURED` | Kesalahan server / `API_KEY` belum diset |

---

## 15. Testing

```bash
npm test
```

Test berjalan **di dalam runtime Workers asli** (workerd) memakai [`@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/), lengkap dengan D1 lokal dan rate limiter. Jadi yang dites benar-benar perilaku produksi, bukan mock.

Cara kerjanya:
1. [`vitest.config.ts`](vitest.config.ts) memakai plugin `cloudflareTest` yang membaca binding dari `wrangler.jsonc`, meng-*override* `API_KEY` dengan nilai khusus test, dan membaca migration lewat `readD1Migrations()` (berjalan di Node.js).
2. Migration dikirim ke runtime sebagai binding `TEST_MIGRATIONS`, lalu [`test/apply-migrations.ts`](test/apply-migrations.ts) menjalankan `applyD1Migrations(env.DB, ...)` sebelum test.
3. Test memanggil aplikasi lewat **`app.request(path, init, env)`**, yaitu cara bawaan Hono untuk mengirim request tanpa menjalankan server, dengan `env` asli dari `cloudflare:workers`.

Yang dites (40 test):
- Create: sukses, trim/lowercase, phone opsional, setiap aturan validasi, field tak dikenal, JSON rusak, email duplikat (tidak peka huruf besar/kecil).
- List: paginasi, filter stage, pencarian, escape wildcard `%`, query tidak valid.
- Get/Delete: sukses, 404, id bukan UUID.
- Stage: pipeline lengkap sampai `hired`, reject, semua jenis perpindahan ilegal, stage tak dikenal.
- Keamanan: tanpa key, key salah, route publik, rate limit 429 + `Retry-After`, isolasi per IP.
- OpenAPI: semua path & skema keamanan terdaftar.

---

## 16. Deploy ke Cloudflare

Butuh akun Cloudflare (gratis cukup).

**1. Login**

```bash
npx wrangler login
```

**2. Buat database D1 di Cloudflare**

```bash
npx wrangler d1 create sekolah-karir-db
```

Salin `database_id` yang muncul ke `wrangler.jsonc` (ganti `00000000-0000-0000-0000-000000000000`).

**3. Terapkan migration ke database remote**

```bash
npm run db:migrate:remote
```

**4. Pasang secret API key** (gunakan nilai acak yang panjang, mis. hasil `openssl rand -hex 32`)

```bash
npx wrangler secret put API_KEY
```

**5. Deploy**

```bash
npm run deploy
```

Worker akan tersedia di `https://sekolah-karir-api.<subdomain-kamu>.workers.dev`. Buka `/docs` untuk mencobanya.

**6. Melihat log produksi secara real-time**

```bash
npx wrangler tail
```

---

## 17. Batas Free Tier yang Perlu Diketahui

Angka berikut adalah gambaran umum; selalu cek halaman pricing resmi Cloudflare karena bisa berubah.

| Layanan | Batas free (perkiraan) |
|---|---|
| Workers | ±100.000 request/hari, CPU time singkat per request |
| D1 | ±5 juta baris dibaca/hari, ±100.000 baris ditulis/hari, ±5 GB penyimpanan |
| Rate Limiting binding | Tersedia, tanpa biaya tambahan |

Desain project ini sudah memperhitungkannya:
- **Rate limit** mencegah satu klien menghabiskan kuota harian.
- **`limit` maksimal 100** per halaman membatasi jumlah baris dibaca per request.
- **Index** pada `stage` dan `created_at` mengurangi baris yang dipindai.
- Validasi dilakukan **sebelum** menyentuh D1, sehingga request tidak valid tidak memakan kuota database.

---

## 18. Troubleshooting

| Masalah | Solusi |
|---|---|
| `no such table: applicants` | Jalankan `npm run db:migrate:local` (atau `:remote` untuk produksi) |
| Semua request 401 | Pastikan header `Authorization: Bearer <key>` dan nilai key sama dengan `.dev.vars` / secret produksi |
| Semua request 500 `SERVER_MISCONFIGURED` | `API_KEY` belum diset: buat `.dev.vars` (lokal) atau `wrangler secret put API_KEY` (produksi) |
| Tipe `Env` tidak mengenali binding baru | Jalankan `npm run cf-typegen` |
| `wrangler` gagal jalan setelah install (Windows/npm baru) | `npm install-scripts approve workerd esbuild` lalu `npm rebuild` |
| Ingin mengosongkan DB lokal | Hapus folder `.wrangler/state`, lalu migrasi ulang |
| Deploy gagal karena `database_id` | Ganti placeholder di `wrangler.jsonc` dengan ID dari `wrangler d1 create` |

---

## 19. Langkah Belajar Selanjutnya

Beberapa ide untuk mengembangkan project ini sambil belajar fitur Cloudflare lain:

- **Riwayat stage**: tabel `stage_history`, ditulis bersamaan dengan update stage memakai `db.batch()` agar atomik.
- **Paginasi cursor** (berbasis `created_at` + `id`), lebih efisien daripada `OFFSET` untuk data besar.
- **JWT / Cloudflare Access** untuk autentikasi multi-user dan peran (recruiter, admin).
- **KV** untuk caching hasil list yang sering dibaca.
- **Queues** untuk mengirim notifikasi email saat stage berubah, tanpa memperlambat respons.
- **R2** untuk menyimpan file CV pelamar.
- **CI dengan GitHub Actions**: jalankan `npm test` di setiap push, lalu deploy otomatis dengan `cloudflare/wrangler-action`.

### Referensi

- Hono: https://hono.dev
- Hono + Zod OpenAPI: https://hono.dev/examples/zod-openapi
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare D1: https://developers.cloudflare.com/d1/
- Workers Rate Limiting: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Vitest integration: https://developers.cloudflare.com/workers/testing/vitest-integration/
- Zod: https://zod.dev
