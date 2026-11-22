import { Task as T } from '@homingbird/kernel'
import {
  type Channel,
  Conflict,
  type ConversationId,
  Forbidden,
  type MemberId,
  MemberId as MemberIds,
  NotFound,
  SLACK_CODE_LIFETIME_MS,
  slackCodeHref,
} from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import { describeChannel, enter, existingChannel, managersOf, visibilityOf } from '../domain/channel-rows.ts'
import { lockGroups } from '../domain/group-rows.ts'
import type { AppEnv, Caller } from '../environment.ts'
import { type RequestEnv, transact } from '../events/events.ts'
import { hashSecret } from '../random.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { calling } from './slack-people.ts'
import { slackTextsIn } from './slack-texts.ts'
import type { SlackChannel, SlackUser } from './slack-web-api.ts'
import { type WorkingSlack, workingSlack } from './slack-workspace.ts'

/**
 * Links the Slack channel a code names to a Homingbird channel the person manages, under the channel
 * group's lock. The Homingbird side is never more open than the Slack side: a private Slack channel
 * links only to a private channel, and one shared with another organization never links (rule 6).
 */
export const linkSlackChannel = (
  caller: Caller,
  slug: string,
  code: string,
): T.Task<Channel, NotFound | Forbidden | Conflict, AppEnv> =>
  T.gen(function* () {
    const slack = yield* workingSlack
    if (slack === null) return yield* T.fail(Conflict({ message: 'Slack is not connected on this server.' }))
    const linked = yield* transact(linkUnderLock(caller, slug, code))
    yield* calling(
      'chat.postMessage',
      slack.api.postMessage({
        channel: linked.slackChannel.id,
        text: slackTextsIn(null).channelLinked(`#${slug}`),
      }),
    )
    return linked.channel
  })

/** Unlinks a channel: only its managers may, with Slack off too; the notes that arrived stay. */
export const unlinkSlackChannel = (
  caller: Caller,
  slug: string,
): T.Task<string | null, NotFound | Forbidden, RequestEnv> =>
  T.gen(function* () {
    const row = yield* existingChannel(slug)
    yield* lockGroups([row.manager_group_id])
    if (!(yield* managersOf(row)).includes(caller.member.id))
      return yield* T.fail(Forbidden({ message: ONLY_MANAGERS }))
    return yield* removeChannelLink(row.conversation_id)
  })

/** Removes a room's link, if it has one, and says which Slack channel it was. */
export const removeChannelLink = (conversationId: ConversationId): T.Task<string | null, never, RequestEnv> =>
  T.gen(function* () {
    const link = yield* linkOfRoom(conversationId)
    if (link === null) return null
    yield* run(sql`UPDATE slack_outbox SET state = 'failed' WHERE slack_channel_id = ${link.slack_channel_id}
      AND state = 'pending'`)
    yield* run(sql`DELETE FROM slack_channel_links WHERE conversation_id = ${link.conversation_id}`)
    yield* run(sql`UPDATE members SET status = 'deactivated' WHERE id = ${link.link_member_id}`)
    return link.slack_channel_id
  })

/** Stops a link for a reason Slack gave or the outbox found, and records it once. */
export const stopSlackLink = (link: SlackLinkRow, because: SlackLinkStop): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const stopped =
      yield* run(sql`UPDATE slack_channel_links SET state = 'stopped', stopped_because = ${because}
      WHERE conversation_id = ${link.conversation_id} AND state = 'active'`)
    if (stopped === 0) return
    yield* run(sql`UPDATE slack_outbox SET state = 'failed' WHERE slack_channel_id = ${link.slack_channel_id}
      AND state = 'pending'`)
    const slug = yield* first<{ slug: string }>(
      sql`SELECT slug FROM channels WHERE conversation_id = ${link.conversation_id}`,
    )
    yield* recordAudit('slack.channel.stopped', {
      targetId: slug?.slug ?? link.conversation_id,
      detail: { slackChannel: link.slack_channel_id, because },
    })
  })

/**
 * Answers a linked person who mentioned the app with `link` in a Slack channel not linked yet, to them
 * only, with a code they confirm in the web client by choosing a channel they manage.
 */
export const offerChannelLink = (
  slack: WorkingSlack,
  user: SlackUser,
  memberId: MemberId,
  place: { readonly channel: string; readonly threadTs?: string },
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const texts = slackTextsIn(null)
    const channel = yield* calling('conversations.info', slack.api.channelInfo(place.channel))
    if (channel === undefined) return
    const text = channel.isExternal
      ? texts.sharedChannel
      : texts.channelLinkOffered(
          `${env.config.publicUrl}/${slackCodeHref(yield* transact(makeChannelCode(user, memberId, channel)))}`,
        )
    yield* calling('chat.postEphemeral', slack.api.postEphemeral({ ...place, user: user.id, text }))
  })

/** The channels a person could link a Slack channel to: those they manage, private ones for a private channel. */
export const channelChoicesFor = (
  memberId: MemberId,
  slackChannel: SlackChannelFacts,
): T.Task<string[], never, AppEnv> =>
  T.gen(function* () {
    const rows = yield* all<{ slug: string; visibility: string | null }>(sql`
      SELECT c.slug, c.visibility FROM channels c
      JOIN group_members g ON g.group_id = c.manager_group_id AND g.member_id = ${memberId}
      JOIN participants p ON p.conversation_id = c.conversation_id AND p.member_id = ${memberId}
      WHERE NOT EXISTS (SELECT 1 FROM slack_channel_links l WHERE l.conversation_id = c.conversation_id)
      ORDER BY c.slug`)
    return rows
      .filter((row) => !slackChannel.isPrivate || row.visibility === 'private')
      .map((row) => row.slug)
  })

const linkOfRoom = (conversationId: ConversationId): T.Task<SlackLinkRow | null, never, AppEnv> =>
  first<SlackLinkRow>(sql`SELECT * FROM slack_channel_links WHERE conversation_id = ${conversationId}`)

export const linkOfSlackChannel = (slackChannelId: string): T.Task<SlackLinkRow | null, never, AppEnv> =>
  first<SlackLinkRow>(sql`SELECT * FROM slack_channel_links WHERE slack_channel_id = ${slackChannelId}`)

export type SlackLinkStop = 'app_removed' | 'archived' | 'deleted' | 'pairing' | 'failures'

export interface SlackChannelFacts {
  readonly id: string
  readonly name: string
  readonly isPrivate: boolean
  readonly memberCount: number | null
}

export interface SlackLinkRow {
  readonly conversation_id: ConversationId
  readonly slack_channel_id: string
  readonly slack_channel_name: string
  readonly is_private: number
  readonly member_count: number | null
  readonly link_member_id: MemberId
  readonly state: 'active' | 'stopped'
  readonly stopped_because: SlackLinkStop | null
  readonly failures: number
}

const ONLY_MANAGERS = 'Only a manager of this channel can link it to Slack or unlink it.'

const linkUnderLock = (
  caller: Caller,
  slug: string,
  code: string,
): T.Task<
  { readonly channel: Channel; readonly slackChannel: SlackChannelFacts },
  NotFound | Forbidden | Conflict,
  RequestEnv
> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const row = yield* existingChannel(slug)
    yield* lockGroups([row.manager_group_id])
    if (!(yield* managersOf(row)).includes(caller.member.id))
      return yield* T.fail(Forbidden({ message: ONLY_MANAGERS }))
    const codeRow = yield* first<{ code_hash: string; slack_channel: string | null }>(sql`
      SELECT code_hash, slack_channel FROM slack_codes WHERE code_hash = ${hashSecret(code)} AND kind = 'channel'
      AND member_id = ${caller.member.id} AND used_at IS NULL AND expires_at > ${env.clock.now()}`)
    if (codeRow === null || codeRow.slack_channel === null)
      return yield* T.fail(NotFound({ message: 'This link is no longer valid. Ask for a new one.' }))
    const slackChannel = JSON.parse(codeRow.slack_channel) as SlackChannelFacts
    if (slackChannel.isPrivate && visibilityOf(row) !== 'private')
      return yield* T.fail(
        Conflict({
          message: 'A private Slack channel links only to a private channel, never to an open one.',
        }),
      )
    if ((yield* linkOfRoom(row.conversation_id)) !== null)
      return yield* T.fail(Conflict({ message: 'This channel is already linked to a Slack channel.' }))
    if ((yield* linkOfSlackChannel(slackChannel.id)) !== null)
      return yield* T.fail(Conflict({ message: 'This Slack channel is already linked to another channel.' }))
    yield* run(
      sql`UPDATE slack_codes SET used_at = ${env.clock.now()} WHERE code_hash = ${codeRow.code_hash}`,
    )
    const linkMember = MemberIds.of(env.random.identifier())
    yield* run(
      insertInto('members', {
        id: linkMember,
        email: `${linkMember}@links.invalid`,
        subject: `link:${linkMember}`,
        name: `Slack #${slackChannel.name}`.slice(0, NAME_MAX),
        profile: '',
        role: 'member',
        status: 'active',
        kind: 'chat_link',
        event_seq: 0,
        created_at: env.clock.now(),
        last_seen_at: null,
      }),
    )
    yield* enter(row.conversation_id, linkMember)
    yield* run(
      insertInto('slack_channel_links', {
        conversation_id: row.conversation_id,
        slack_channel_id: slackChannel.id,
        slack_channel_name: slackChannel.name.slice(0, NAME_MAX),
        is_private: slackChannel.isPrivate ? 1 : 0,
        member_count: slackChannel.memberCount,
        link_member_id: linkMember,
        state: 'active',
        stopped_because: null,
        failures: 0,
        linked_by: caller.member.id,
        linked_at: env.clock.now(),
      }),
    )
    return { channel: yield* describeChannel(caller.member, row), slackChannel }
  })

const makeChannelCode = (
  user: SlackUser,
  memberId: MemberId,
  channel: SlackChannel,
): T.Task<string, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const code = env.random.secret()
    const now = env.clock.now()
    const facts: SlackChannelFacts = {
      id: channel.id,
      name: channel.name,
      isPrivate: channel.isPrivate,
      memberCount: channel.memberCount,
    }
    yield* run(
      insertInto('slack_codes', {
        code_hash: hashSecret(code),
        kind: 'channel',
        member_id: memberId,
        slack_user_id: user.id,
        slack_name: user.name.slice(0, NAME_MAX),
        created_at: now,
        expires_at: now + SLACK_CODE_LIFETIME_MS,
        used_at: null,
        slack_channel: JSON.stringify(facts),
      }),
    )
    return code
  })

const NAME_MAX = 200
