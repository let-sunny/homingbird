import { type Migration, id, integer, optionalId, optionalString } from '../schema-steps.ts'

/**
 * What a scheduling room's meeting told each person, kept so the web client lists it without push
 * notifications. Nothing was kept before this step, so nothing is backfilled.
 */
export const MEETING_NOTICES: Migration = [
  {
    name: 'meeting_notices',
    columns: {
      id,
      debate_id: id,
      member_id: id,
      notice: optionalString,
      about_member_id: optionalId,
      because: optionalString,
      agent_name: optionalString,
      created_at: integer,
    },
    primaryKey: ['id'],
    indexes: [{ columns: ['member_id', 'debate_id'] }],
  },
]
