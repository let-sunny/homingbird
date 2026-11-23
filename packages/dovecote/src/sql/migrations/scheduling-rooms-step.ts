import {
  type Migration,
  id,
  integer,
  optionalInteger,
  optionalString,
  optionalText,
} from '../schema-steps.ts'

/**
 * A room stored before this step is a debate. A scheduling room's title is its question; its meeting,
 * attendees and their free slots, from their agent's turn or chosen by themself, are new tables.
 */
export const SCHEDULING_ROOMS: Migration = [
  { addTo: 'debates', name: 'room_type', column: optionalString },
  {
    name: 'scheduling_rooms',
    columns: {
      debate_id: id,
      minutes: integer,
      window_starts_at: integer,
      window_ends_at: integer,
      slot_starts_at: optionalInteger,
      invite_uid: optionalString,
      meeting_url: optionalText,
      invite_state: optionalString,
      invite_changed_at: optionalInteger,
    },
    primaryKey: ['debate_id'],
  },
  {
    name: 'scheduling_attendees',
    columns: {
      debate_id: id,
      member_id: id,
      required: integer,
      answer: optionalString,
      state: optionalString,
      by_delegation: optionalInteger,
      changed_at: optionalInteger,
    },
    primaryKey: ['debate_id', 'member_id'],
    indexes: [{ columns: ['member_id'] }],
  },
  {
    name: 'room_free_slots',
    columns: {
      debate_id: id,
      member_id: id,
      starts_at: integer,
      ends_at: integer,
      by_person: optionalInteger,
      created_at: integer,
    },
    primaryKey: ['debate_id', 'member_id', 'starts_at'],
  },
]
