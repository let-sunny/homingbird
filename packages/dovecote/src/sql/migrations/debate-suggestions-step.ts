import {
  type Migration,
  id,
  integer,
  optionalId,
  optionalInteger,
  optionalString,
  text,
} from '../schema-steps.ts'

/**
 * An agent's suggestion to talk a note over before it answers, the colleagues it names, and on a room the
 * suggestion its person opened it from. A suggestion is a card until its person decides it.
 */
export const DEBATE_SUGGESTIONS: Migration = [
  {
    name: 'debate_suggestions',
    columns: {
      id,
      member_id: id,
      credential_id: id,
      in_reply_to: id,
      conversation_id: id,
      draft_id: optionalId,
      question: text,
      reason: text,
      created_at: integer,
      decided_at: optionalInteger,
      decision: optionalString,
      debate_id: optionalId,
      answered_at: optionalInteger,
    },
    primaryKey: ['id'],
    indexes: [{ columns: ['member_id', 'decided_at'] }],
  },
  {
    name: 'debate_suggestion_people',
    columns: { suggestion_id: id, member_id: id, position: integer },
    primaryKey: ['suggestion_id', 'member_id'],
  },
  { addTo: 'debates', name: 'suggestion_id', column: optionalId },
]
