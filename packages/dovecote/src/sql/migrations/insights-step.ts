import { type Migration, id, integer, optionalInteger } from '../schema-steps.ts'

/**
 * Who was in which group when, so a team's figures count each person for the days they were in it. A
 * span from 0 began before records; the backfill skips a member who has an open span, so it runs twice.
 */
export const INSIGHTS: Migration = [
  {
    name: 'group_member_spans',
    columns: { group_id: id, member_id: id, since: integer, until: optionalInteger },
    primaryKey: ['group_id', 'member_id', 'since'],
    indexes: [{ columns: ['member_id'] }],
  },
  {
    backfill: `INSERT INTO group_member_spans (group_id, member_id, since, until)
      SELECT g.group_id, g.member_id, 0, NULL FROM group_members g
      WHERE NOT EXISTS (SELECT 1 FROM group_member_spans s
        WHERE s.group_id = g.group_id AND s.member_id = g.member_id AND s.until IS NULL)`,
  },
]
