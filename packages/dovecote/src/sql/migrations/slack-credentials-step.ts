import { type Migration, id, integer, string, text } from '../schema-steps.ts'

/** Each value is sealed with its giver and its part, so a copied or swapped value does not open. */
export const SLACK_CREDENTIALS: Migration = [
  {
    name: 'slack_credentials',
    columns: {
      slot: string,
      given_by: id,
      bot_token_sealed: text,
      signing_secret_sealed: text,
      given_at: integer,
    },
    primaryKey: ['slot'],
    indexes: [{ columns: ['given_by'] }],
  },
]
