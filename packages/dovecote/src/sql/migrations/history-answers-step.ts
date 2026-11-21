import { type Migration, id, integer } from '../schema-steps.ts'

/**
 * Who said an earlier answer answered the question they were writing, to which room, and when: counted
 * per place, never listed. One row per person, room and answer, so a second click counts nothing.
 */
export const HISTORY_ANSWERS: Migration = [
  {
    name: 'history_answers',
    columns: { member_id: id, conversation_id: id, note_id: id, answered_at: integer },
    primaryKey: ['member_id', 'conversation_id', 'note_id'],
    indexes: [{ columns: ['conversation_id'] }],
  },
]
