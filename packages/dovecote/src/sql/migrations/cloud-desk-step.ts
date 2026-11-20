import {
  type Migration,
  id,
  integer,
  optionalInteger,
  optionalString,
  string,
  text,
} from '../schema-steps.ts'

/**
 * One wake per person for a desk in a cloud agent service. The address and headers are sealed with the
 * member id as associated data; the host stays plain to show without opening them.
 */
export const CLOUD_DESK: Migration = [
  {
    name: 'desk_wakes',
    columns: {
      member_id: id,
      credential_id: id,
      host: string,
      sealed: text,
      enabled: integer,
      last_wake_at: optionalInteger,
      last_status: string,
      failures: integer,
      retry_at: optionalInteger,
      stopped_because: optionalString,
      created_at: integer,
      updated_at: integer,
    },
    primaryKey: ['member_id'],
    indexes: [{ columns: ['credential_id'] }],
  },
]
