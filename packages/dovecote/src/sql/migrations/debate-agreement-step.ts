import { type Migration, optionalInteger, optionalString } from '../schema-steps.ts'

/**
 * Whether an agent said with its turn that it was ready to conclude, 1 when it did, and why a room
 * stopped taking turns: every turn and room before this step reads as not ready, with no reason given.
 */
export const DEBATE_AGREEMENT: Migration = [
  { addTo: 'debate_turns', name: 'ready', column: optionalInteger },
  { addTo: 'debates', name: 'concluded_because', column: optionalString },
]
