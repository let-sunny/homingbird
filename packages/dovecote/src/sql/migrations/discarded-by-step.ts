import { type Migration, optionalId } from '../schema-steps.ts'

/**
 * Which manager discarded a channel's agent's answer, as `approved_by` says who sent one; empty for a
 * person's own draft and for every discard before this step.
 */
export const DISCARDED_BY: Migration = [{ addTo: 'notes', name: 'discarded_by', column: optionalId }]
