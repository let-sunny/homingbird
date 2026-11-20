import { type Migration, optionalId, optionalString } from '../schema-steps.ts'

/** Every member before channel agents is a person; the backfill skips what it set, so MySQL can run it twice. */
export const CHANNEL_AGENTS: Migration = [
  { addTo: 'members', name: 'kind', column: optionalString },
  { backfill: `UPDATE members SET kind = 'person' WHERE kind IS NULL` },
  { addTo: 'notes', name: 'approved_by', column: optionalId },
  { addTo: 'credentials', name: 'issued_by', column: optionalId },
  { addTo: 'conversations', name: 'channel_id', column: optionalId },
  { addTo: 'conversations', name: 'asked_by', column: optionalId },
  { indexOn: 'conversations', columns: ['channel_id'] },
]
