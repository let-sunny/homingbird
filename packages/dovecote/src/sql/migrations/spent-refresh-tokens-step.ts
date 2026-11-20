import { type Migration, id, integer, string } from '../schema-steps.ts'

/**
 * Every refresh token a refresh replaced, by hash, and the hash of the one that replaced it, so presenting
 * a spent one again revokes its credential.
 */
export const SPENT_REFRESH_TOKENS: Migration = [
  {
    name: 'spent_refresh_tokens',
    columns: { refresh_hash: string, credential_id: id, spent_at: integer, replaced_by: string },
    primaryKey: ['refresh_hash'],
    indexes: [{ columns: ['credential_id'] }],
  },
]
