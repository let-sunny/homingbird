import { type Migration, id, integer, optionalId, optionalString, string } from '../schema-steps.ts'

/**
 * Every channel gets a group of its active managers in its room. Backfills read the same everywhere (no
 * `||` or `CONCAT`) and skip what is there, so a half-applied MySQL step runs again; MySQL reserves `groups`.
 */
export const GROUPS: Migration = [
  {
    name: 'member_groups',
    columns: { id, kind: string, name: optionalString, created_by: optionalId, created_at: integer },
    primaryKey: ['id'],
  },
  {
    name: 'group_members',
    columns: { group_id: id, member_id: id },
    primaryKey: ['group_id', 'member_id'],
    indexes: [{ columns: ['member_id'] }],
  },
  { addTo: 'channels', name: 'manager_group_id', column: optionalId },
  { indexOn: 'channels', columns: ['manager_group_id'] },
  {
    backfill: `INSERT INTO member_groups (id, kind, created_by, created_at)
      SELECT REPLACE(c.conversation_id, 'conv_', 'grp_'), 'channel', c.created_by, c.created_at FROM channels c
      WHERE NOT EXISTS (SELECT 1 FROM member_groups x WHERE x.id = REPLACE(c.conversation_id, 'conv_', 'grp_'))`,
  },
  {
    backfill: `INSERT INTO group_members (group_id, member_id)
      SELECT REPLACE(g.conversation_id, 'conv_', 'grp_'), g.member_id FROM channel_managers g
      JOIN participants p ON p.conversation_id = g.conversation_id AND p.member_id = g.member_id
      JOIN members m ON m.id = g.member_id
      WHERE m.status = 'active'
        AND EXISTS (SELECT 1 FROM member_groups x WHERE x.id = REPLACE(g.conversation_id, 'conv_', 'grp_'))
        AND NOT EXISTS (SELECT 1 FROM group_members y
          WHERE y.group_id = REPLACE(g.conversation_id, 'conv_', 'grp_') AND y.member_id = g.member_id)`,
  },
  {
    backfill: `UPDATE channels SET manager_group_id = REPLACE(conversation_id, 'conv_', 'grp_')
      WHERE manager_group_id IS NULL
        AND EXISTS (SELECT 1 FROM member_groups x WHERE x.id = REPLACE(channels.conversation_id, 'conv_', 'grp_'))`,
  },
]
