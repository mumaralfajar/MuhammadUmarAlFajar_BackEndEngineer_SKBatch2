-- Migration: 0001_create_applicants
-- Tabel utama untuk menyimpan data pelamar (applicant).

CREATE TABLE IF NOT EXISTS applicants (
  id          TEXT PRIMARY KEY,                       -- UUID v4, dibuat oleh Worker
  full_name   TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,    -- unik, tidak peka huruf besar/kecil
  phone       TEXT,                                   -- opsional, format E.164
  position    TEXT NOT NULL,                          -- posisi yang dilamar
  stage       TEXT NOT NULL DEFAULT 'applied'
              CHECK (stage IN ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected')),
  created_at  TEXT NOT NULL,                          -- ISO 8601 (UTC)
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_applicants_stage ON applicants (stage);
CREATE INDEX IF NOT EXISTS idx_applicants_created_at ON applicants (created_at);
