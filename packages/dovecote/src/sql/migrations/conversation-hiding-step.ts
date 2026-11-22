import { type Migration, optionalInteger } from '../schema-steps.ts'

/**
 * When a person hid a conversation from their own list, kept on their place in it like a mute, so
 * leaving the room ends it and nobody can hide a room they are not in.
 */
export const CONVERSATION_HIDING: Migration = [
  { addTo: 'participants', name: 'hidden_at', column: optionalInteger },
]
