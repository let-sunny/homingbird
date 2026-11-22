import {
  type Migration,
  id,
  integer,
  optionalId,
  optionalInteger,
  optionalString,
  optionalText,
  string,
  text,
} from '../schema-steps.ts'

/**
 * A Slack channel linked to a Homingbird channel, whose link is a member of the room; the notes that
 * arrived from it, each a copy of one Slack message; the threads they started, by their newest message;
 * and the outbox of sent notes to post, one row per note. Slack's ids and message times are short, so they
 * are `id` columns: two of them make a key MySQL can index.
 */
export const SLACK_CHANNELS: Migration = [
  {
    name: 'slack_channel_links',
    columns: {
      conversation_id: id,
      slack_channel_id: id,
      slack_channel_name: string,
      is_private: integer,
      member_count: optionalInteger,
      link_member_id: id,
      state: string,
      stopped_because: optionalString,
      failures: integer,
      linked_by: id,
      linked_at: integer,
    },
    primaryKey: ['conversation_id'],
    indexes: [{ columns: ['slack_channel_id'], unique: true }, { columns: ['link_member_id'] }],
  },
  {
    name: 'slack_arrivals',
    columns: {
      note_id: id,
      conversation_id: id,
      slack_channel_id: id,
      message_ts: id,
      thread_ts: id,
      asker_slack_id: id,
      asker_name: string,
      asker_member_id: optionalId,
      asker_linked: integer,
      edited: integer,
      deleted: integer,
      created_at: integer,
    },
    primaryKey: ['note_id'],
    indexes: [{ columns: ['slack_channel_id', 'message_ts'], unique: true }, { columns: ['asker_slack_id'] }],
  },
  {
    name: 'slack_threads',
    columns: {
      slack_channel_id: id,
      thread_ts: id,
      newest_ts: id,
      newer_messages: integer,
    },
    primaryKey: ['slack_channel_id', 'thread_ts'],
  },
  {
    name: 'slack_outbox',
    columns: {
      note_id: id,
      slack_channel_id: id,
      thread_ts: id,
      text: text,
      state: string,
      attempts: integer,
      uncertain: integer,
      next_at: integer,
      posted_ts: optionalId,
      created_at: integer,
    },
    primaryKey: ['note_id'],
    indexes: [{ columns: ['state', 'next_at'] }],
  },
  { addTo: 'slack_codes', name: 'slack_channel', column: optionalText },
]
