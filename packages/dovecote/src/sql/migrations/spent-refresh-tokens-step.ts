import { type Migration, id, integer, string } from '../schema-steps.ts'

/** Every refresh token a refresh replaced, by hash, so presenting one again revokes its credential. */
export const SPENT_REFRESH_TOKENS: Migration = [
  {
    name: 'spent_refresh_tokens',
    columns: { refresh_hash: string, credential_id: id, spent_at: integer },
    primaryKey: ['refresh_hash'],
    indexes: [{ columns: ['credential_id'] }],
  },
]
