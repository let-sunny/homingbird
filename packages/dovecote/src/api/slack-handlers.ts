import { Task as T } from '@homingbird/kernel'
import { SLACK_EVENTS_PATH, slackManifest } from '@homingbird/protocol'
import type { RequestEnv } from '../events/events.ts'
import {
  linkSlackPerson,
  requestSlackLink,
  slackCodeFor,
  slackOfMember,
  unlinkSlackPerson,
} from '../slack/slack-people.ts'
import { pinnedWorkspace, workspaceView } from '../slack/slack-workspace.ts'
import { first } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import type { Handlers } from './handlers.ts'

/**
 * Slack, for a person and for an administrator. Every route is a person's or an administrator's, so no
 * agent credential and no tool a model reaches links anyone or anything to Slack (rule 3).
 */
export const slackHandlers = {
  'me.slack.get': (_, caller) => slackOfMember(caller.member.id),
  'me.slack.connect': (_, caller) => requestSlackLink(caller),
  'me.slack.link': ({ body }, caller) => linkSlackPerson(caller, body.code),
  'me.slack.unlink': (_, caller) => T.as({})(unlinkSlackPerson(caller.member.id)),
  'slack.codes.get': ({ params }, caller) => slackCodeFor(caller, params.id),
  'admin.slack.get': () =>
    T.gen(function* () {
      const env = yield* T.ask<RequestEnv>()
      const workspace = yield* pinnedWorkspace
      const people = yield* first<{ total: number }>(sql`SELECT COUNT(*) AS total FROM slack_people`)
      return {
        workspace: workspace === null ? null : workspaceView(workspace),
        eventsUrl: `${env.config.publicUrl}${SLACK_EVENTS_PATH}`,
        manifest: slackManifest(env.config.publicUrl),
        linkedPeople: Number(people?.total ?? 0),
      }
    }),
} satisfies Partial<Handlers>
