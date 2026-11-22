import { type Migration, id, optionalId, optionalInteger } from '../schema-steps.ts'

/**
 * A saved answer's switch to send itself and the conversations where it may, the answer that sent a
 * note without a click, and when its author recalled it.
 */
export const AUTO_SEND: Migration = [
  { addTo: 'principles', name: 'auto_send', column: optionalInteger },
  {
    name: 'principle_auto_send_places',
    columns: { principle_id: id, conversation_id: id },
    primaryKey: ['principle_id', 'conversation_id'],
  },
  { addTo: 'notes', name: 'auto_principle_id', column: optionalId },
  { addTo: 'notes', name: 'withdrawn_at', column: optionalInteger },
]
