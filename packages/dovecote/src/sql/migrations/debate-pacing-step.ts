import { type Migration, optionalInteger } from '../schema-steps.ts'

/**
 * Whether a room's total follows the agents opted in, set to 1 for rooms that do: every room before this
 * step keeps the total it was given. And the last turn an agent said it had read when it wrote a turn.
 */
export const DEBATE_PACING: Migration = [
  { addTo: 'debates', name: 'total_follows_agents', column: optionalInteger },
  { addTo: 'debate_turns', name: 'after_turn', column: optionalInteger },
]
