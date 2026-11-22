import { type Migration, optionalText } from '../schema-steps.ts'

/**
 * What a draft rests on as its agent reported it, beside the free-text basis, and why a person discarded
 * a draft; both may be empty, and every note before this step has neither.
 */
export const SOURCES_AND_REASONS: Migration = [
  { addTo: 'notes', name: 'sources', column: optionalText },
  { addTo: 'notes', name: 'discard_reason', column: optionalText },
]
