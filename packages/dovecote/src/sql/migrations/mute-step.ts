import { type Migration, optionalInteger, optionalString } from '../schema-steps.ts'

/**
 * When a person muted a conversation, kept on their place in it so leaving the room ends the mute, and
 * which conversations may send them push notifications; an empty level means all of them.
 */
export const MUTE: Migration = [
  { addTo: 'participants', name: 'muted_at', column: optionalInteger },
  { addTo: 'members', name: 'notifications', column: optionalString },
]
