import { type Migration, id, integer, optionalInteger, optionalText, text } from '../schema-steps.ts'

/**
 * Settling a room's result by vote: every agent's draft of a round, the votes, when the vote opened and
 * which agents had dropped out when it closed; and the room's grace, in minutes.
 */
export const RESULT_VOTES: Migration = [
  { addTo: 'debates', name: 'votes_open_at', column: optionalInteger },
  { addTo: 'debates', name: 'grace_minutes', column: optionalInteger },
  { addTo: 'debates', name: 'dropped_out', column: optionalText },
  {
    name: 'debate_drafts',
    columns: {
      debate_id: id,
      round: integer,
      member_id: id,
      credential_id: id,
      result: text,
      created_at: integer,
    },
    primaryKey: ['debate_id', 'round', 'member_id'],
  },
  {
    name: 'debate_votes',
    columns: { debate_id: id, round: integer, voter_id: id, draft_by: id, created_at: integer },
    primaryKey: ['debate_id', 'round', 'voter_id'],
  },
]
