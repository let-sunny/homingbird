import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { Timestamp } from './ids.ts'

/** The server's Slack workspace as an administrator reads it: never its token or signing secret. */
export const SlackWorkspace = S.struct({
  team: S.string({ maxLength: 200 }),
  state: S.tolerant(S.literal('connected', 'stopped'), UNKNOWN),
  stoppedBecause: S.nullable(S.tolerant(S.literal('token_refused', 'revoked', 'other_workspace'), UNKNOWN)),
  connectedAt: Timestamp,
  lastEventAt: S.nullable(Timestamp),
})
export type SlackWorkspace = S.Infer<typeof SlackWorkspace>

export const AdminSlack = S.struct({
  workspace: S.nullable(SlackWorkspace),
  eventsUrl: S.string({ maxLength: 2100 }),
  manifest: S.string({ maxLength: 8000 }),
  linkedPeople: S.int({ min: 0 }),
})
export type AdminSlack = S.Infer<typeof AdminSlack>

/** A person's own link to a Slack user of the server's workspace. */
export const SlackPersonLink = S.struct({ slackName: S.string({ maxLength: 200 }), linkedAt: Timestamp })
export type SlackPersonLink = S.Infer<typeof SlackPersonLink>

export const MeSlack = S.struct({
  team: S.nullable(S.string({ maxLength: 200 })),
  connected: S.boolean,
  link: S.nullable(SlackPersonLink),
})
export type MeSlack = S.Infer<typeof MeSlack>

/** What a single-use link code would do, shown to the person before they confirm it. */
export const SlackCodeView = S.struct({
  kind: S.tolerant(S.literal('person'), UNKNOWN),
  slackName: S.string({ maxLength: 200 }),
  team: S.string({ maxLength: 200 }),
  expiresAt: Timestamp,
})
export type SlackCodeView = S.Infer<typeof SlackCodeView>

export const SlackLinkCode = S.string({ pattern: /^[A-Za-z0-9_-]{20,64}$/ })

export const SLACK_EVENTS_PATH = '/slack/events'

/** Where a link code is confirmed in the web client. */
export const slackCodeHref = (code: string): string => `#/slack/link/${encodeURIComponent(code)}`

export const SLACK_CODE_LIFETIME_MS = 10 * 60 * 1000

/** Scopes and events checked against Slack's reference on docs.slack.dev. */
export const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:read',
  'chat:write',
  'groups:history',
  'groups:read',
  'im:write',
  'reactions:write',
  'users:read',
  'users:read.email',
] as const

export const SLACK_BOT_EVENTS = [
  'app_mention',
  'app_uninstalled',
  'channel_archive',
  'channel_deleted',
  'member_left_channel',
  'message.channels',
  'message.groups',
  'tokens_revoked',
  'user_change',
] as const

/** The app manifest an organization creates its own Slack app from, with this server's address filled in. */
export const slackManifest = (publicUrl: string): string =>
  JSON.stringify(
    {
      display_information: {
        name: 'Homingbird',
        description: 'Questions to Homingbird channels; answers a person approved.',
      },
      features: { bot_user: { display_name: 'Homingbird', always_online: true } },
      oauth_config: { scopes: { bot: SLACK_BOT_SCOPES } },
      settings: {
        event_subscriptions: {
          request_url: `${publicUrl}${SLACK_EVENTS_PATH}`,
          bot_events: SLACK_BOT_EVENTS,
        },
        org_deploy_enabled: false,
        socket_mode_enabled: false,
        token_rotation_enabled: false,
      },
    },
    null,
    2,
  )
