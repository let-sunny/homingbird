import {
  type Migration,
  id,
  integer,
  optionalId,
  optionalInteger,
  optionalString,
  optionalText,
} from '../schema-steps.ts'

/**
 * A person without a row delegates with no limit, so nothing is backfilled. The people a delegation is
 * limited to are rows of their own, none meaning no limit.
 */
export const SCHEDULING_DELEGATIONS: Migration = [
  {
    name: 'scheduling_delegations',
    columns: {
      member_id: id,
      auto_join: optionalInteger,
      auto_add: optionalInteger,
      credential_id: optionalId,
      brief: optionalText,
      max_minutes: optionalInteger,
      hours_from: optionalInteger,
      hours_to: optionalInteger,
      time_zone: optionalString,
      updated_at: integer,
    },
    primaryKey: ['member_id'],
  },
  {
    name: 'scheduling_delegation_people',
    columns: { member_id: id, other_member_id: id },
    primaryKey: ['member_id', 'other_member_id'],
  },
]
