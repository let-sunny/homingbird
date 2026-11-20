import { type Migration, optionalString } from '../schema-steps.ts'

/** The model an agent said it ran as, beside each turn, draft of the result and vote it gave in a room. */
export const DEBATE_MODEL: Migration = [
  { addTo: 'debate_turns', name: 'agent_model', column: optionalString },
  { addTo: 'debate_drafts', name: 'agent_model', column: optionalString },
  { addTo: 'debate_votes', name: 'agent_model', column: optionalString },
]
