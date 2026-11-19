import { type Migration, id, integer, optionalId, optionalString, string, text } from '../schema-steps.ts'

/**
 * The audit trail: one row per security-relevant change, ids and enums only, each chained to the one
 * before by a SHA-256 hash; `audit_head` holds the head and serialises writers.
 */
export const AUDIT_TRAIL: Migration = [
  {
    name: 'audit_events',
    columns: {
      id: { type: 'serial' },
      created_at: integer,
      event: string,
      outcome: string,
      actor_id: optionalId,
      credential_id: optionalId,
      credential_kind: optionalString,
      client_id: optionalString,
      target_kind: string,
      target_id: optionalString,
      request_id: optionalString,
      client_address: optionalString,
      user_agent: optionalString,
      detail: text,
      previous_hash: string,
      hash: string,
    },
    primaryKey: ['id'],
    indexes: [
      { columns: ['created_at'] },
      { columns: ['actor_id'] },
      { columns: ['target_id'] },
      { columns: ['event'] },
    ],
  },
  {
    name: 'audit_head',
    columns: { name: string, last_id: integer, hash: string },
    primaryKey: ['name'],
  },
]
