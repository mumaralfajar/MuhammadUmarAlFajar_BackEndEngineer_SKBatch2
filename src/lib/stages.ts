export const STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const
export type Stage = (typeof STAGES)[number]

/**
 * Aturan perpindahan stage (state machine).
 * Pipeline hanya boleh maju satu langkah; semua stage aktif boleh ke `rejected`.
 * `hired` dan `rejected` adalah stage akhir (terminal).
 */
export const ALLOWED_TRANSITIONS: Record<Stage, readonly Stage[]> = {
  applied: ['screening', 'rejected'],
  screening: ['interview', 'rejected'],
  interview: ['offer', 'rejected'],
  offer: ['hired', 'rejected'],
  hired: [],
  rejected: [],
}

export const canTransition = (from: Stage, to: Stage): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to)
