import {
  type Migration,
  id,
  integer,
  optionalId,
  optionalInteger,
  optionalString,
  optionalText,
  string,
} from '../schema-steps.ts'

/**
 * The one Slack workspace a server answers, pinned by its team id; people's links to their Slack users,
 * one to one; single-use link codes, kept as hashes; and events Slack sent, kept until a pass handles
 * them, by Slack's event id so that a retry does nothing.
 */
export const SLACK: Migration = [
  {
    name: 'slack_workspaces',
    columns: {
      team_id: string,
      team_name: string,
      bot_user_id: string,
      bot_id: optionalString,
      state: string,
      stopped_because: optionalString,
      connected_at: integer,
      checked_at: integer,
      last_event_at: optionalInteger,
    },
    primaryKey: ['team_id'],
  },
  {
    name: 'slack_people',
    columns: {
      member_id: id,
      slack_user_id: string,
      slack_name: string,
      linked_at: integer,
    },
    primaryKey: ['member_id'],
    indexes: [{ columns: ['slack_user_id'], unique: true }],
  },
  {
    name: 'slack_codes',
    columns: {
      code_hash: string,
      kind: string,
      member_id: optionalId,
      slack_user_id: string,
      slack_name: string,
      created_at: integer,
      expires_at: integer,
      used_at: optionalInteger,
    },
    primaryKey: ['code_hash'],
    indexes: [{ columns: ['member_id'] }, { columns: ['expires_at'] }],
  },
  {
    name: 'slack_events',
    columns: {
      event_id: string,
      kind: string,
      payload: optionalText,
      received_at: integer,
      processed_at: optionalInteger,
    },
    primaryKey: ['event_id'],
    indexes: [{ columns: ['processed_at'] }],
  },
]
