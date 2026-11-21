import { type Migration, id, integer, optionalInteger, string } from '../schema-steps.ts'

/**
 * Allowances name a person by member id or a channel by its room, so a renamed channel keeps its own;
 * a draft withdrawn while someone could see it keeps when.
 */
export const DRAFT_PREVIEWS: Migration = [
  {
    name: 'draft_preview_allowances',
    columns: { member_id: id, kind: string, target_id: id, created_at: integer },
    primaryKey: ['member_id', 'kind', 'target_id'],
    indexes: [{ columns: ['kind', 'target_id'] }],
  },
  { addTo: 'notes', name: 'preview_withdrawn_at', column: optionalInteger },
]
