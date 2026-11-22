import { type Migration, optionalInteger, optionalText } from '../schema-steps.ts'

/**
 * The people a group note tags, as a list of member ids, and on each receipt whether its reader's agent
 * is asked; a note and a receipt stored before this step tag nobody and read as asked.
 */
export const NOTE_TAGS: Migration = [
  { addTo: 'notes', name: 'tags', column: optionalText },
  { addTo: 'receipts', name: 'asked', column: optionalInteger },
]
