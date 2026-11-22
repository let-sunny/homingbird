import { type Migration, optionalText } from '../schema-steps.ts'

/**
 * A person's note on what their agent may use and share in one room, kept with the agent they opted in:
 * every participant before this step left none.
 */
export const DEBATE_BRIEFS: Migration = [
  { addTo: 'debate_participants', name: 'brief', column: optionalText },
]
