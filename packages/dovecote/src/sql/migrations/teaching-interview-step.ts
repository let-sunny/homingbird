import {
  type Migration,
  id,
  integer,
  optionalId,
  optionalString,
  optionalText,
  string,
  text,
} from '../schema-steps.ts'

/**
 * Principles a person's own agent proposed in a teaching chat, waiting until the person saves or
 * discards each, and the principles document the person pasted for that chat, one per person.
 */
export const TEACHING_INTERVIEW: Migration = [
  {
    name: 'principle_proposals',
    columns: {
      id,
      member_id: id,
      kind: string,
      topic: string,
      rule: text,
      source: optionalText,
      place: optionalString,
      question: optionalText,
      origin: string,
      rewrite_of: optionalId,
      created_at: integer,
    },
    primaryKey: ['id'],
    indexes: [{ columns: ['member_id', 'created_at'] }],
  },
  {
    name: 'teaching_documents',
    columns: { member_id: id, document: text, updated_at: integer },
    primaryKey: ['member_id'],
  },
]
