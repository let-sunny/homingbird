import { type Migration, id, integer, text } from '../schema-steps.ts'

/**
 * What a channel's managers taught its agent besides its principles, which are kept in `principles`
 * under the agent's member id: the instruction and the sources, as a JSON array of addresses.
 */
export const CHANNEL_TEACHING: Migration = [
  {
    name: 'channel_agent_teaching',
    columns: { agent_id: id, instruction: text, sources: text, updated_at: integer },
    primaryKey: ['agent_id'],
  },
]
