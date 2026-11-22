import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type MeSlack,
  type MemberId,
  NotFound,
  SLACK_CODE_LIFETIME_MS,
  type SlackCodeView,
  slackCodeHref,
} from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import { chosenLocaleOf } from '../domain/members.ts'
import type { AppEnv, Caller } from '../environment.ts'
import { type RequestEnv, transact } from '../events/events.ts'
import { hashSecret } from '../random.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { slackTextsIn } from './slack-texts.ts'
import type { SlackCallFailure, SlackUser } from './slack-web-api.ts'
import { type WorkingSlack, pinnedWorkspace, slackCallFailed, workingSlack } from './slack-workspace.ts'

export const slackOfMember = (memberId: MemberId): T.Task<MeSlack, never, AppEnv> =>
  T.gen(function* () {
    const workspace = yield* pinnedWorkspace
    const link = yield* slackPersonOf(memberId)
    return {
      team: workspace?.team_name ?? null,
      connected: (yield* workingSlack) !== null,
      link: link === null ? null : { slackName: link.slack_name, linkedAt: Number(link.linked_at) },
    }
  })

/** The email only finds the Slack user; the person's confirmation of the code it is sent links them. */
export const requestSlackLink = (caller: Caller): T.Task<{ readonly sent: boolean }, Conflict, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const slack = yield* workingSlack
    if (slack === null) return yield* T.fail(Conflict({ message: NOT_CONNECTED }))
    if ((yield* slackPersonOf(caller.member.id)) !== null)
      return yield* T.fail(Conflict({ message: 'You are already linked to a Slack user; unlink it first.' }))
    const recent = yield* first(sql`SELECT code_hash FROM slack_codes
      WHERE member_id = ${caller.member.id} AND created_at > ${env.clock.now() - REQUEST_SPACING_MS}`)
    if (recent !== null)
      return yield* T.fail(
        Conflict({ message: 'A link was sent less than a minute ago; look for it in Slack.' }),
      )
    const found = yield* calling('users.lookupByEmail', slack.api.userByEmail(caller.member.email))
    if (found === null || found === undefined || !isEligible(slack, found)) return { sent: false }
    if ((yield* slackPersonBySlackUser(found.id)) !== null) return { sent: false }
    const code = yield* transact(makeCode(found, caller.member.id))
    const texts = slackTextsIn(yield* chosenLocaleOf(caller.member.id))
    const direct = yield* calling('conversations.open', slack.api.openDirect(found.id))
    if (direct === undefined) return { sent: false }
    const posted = yield* calling(
      'chat.postMessage',
      slack.api.postMessage({
        channel: direct,
        text: texts.linkRequested(caller.member.email, linkUrl(env, code)),
      }),
    )
    return { sent: posted !== undefined }
  })

export const slackCodeFor = (caller: Caller, code: string): T.Task<SlackCodeView, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* usableCode(caller.member.id, code)
    const workspace = yield* pinnedWorkspace
    return {
      kind: 'person',
      slackName: row.slack_name,
      team: workspace?.team_name ?? '',
      expiresAt: Number(row.expires_at),
    }
  })

export const linkSlackPerson = (
  caller: Caller,
  code: string,
): T.Task<MeSlack, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if ((yield* workingSlack) === null) return yield* T.fail(Conflict({ message: NOT_CONNECTED }))
    const row = yield* usableCode(caller.member.id, code)
    if ((yield* slackPersonOf(caller.member.id)) !== null)
      return yield* T.fail(Conflict({ message: 'You are already linked to a Slack user; unlink it first.' }))
    if ((yield* slackPersonBySlackUser(row.slack_user_id)) !== null)
      return yield* T.fail(
        Conflict({ message: 'This Slack user is already linked to someone in Homingbird.' }),
      )
    const spent = yield* run(sql`UPDATE slack_codes SET used_at = ${env.clock.now()}
      WHERE code_hash = ${row.code_hash} AND used_at IS NULL`)
    if (spent !== 1) return yield* T.fail(NotFound({ message: CODE_GONE }))
    yield* run(
      insertInto('slack_people', {
        member_id: caller.member.id,
        slack_user_id: row.slack_user_id,
        slack_name: row.slack_name,
        linked_at: env.clock.now(),
      }),
    )
    return yield* slackOfMember(caller.member.id)
  })

export const unlinkSlackPerson = (memberId: MemberId): T.Task<boolean, never, RequestEnv> =>
  T.map((removed: number) => removed > 0)(run(sql`DELETE FROM slack_people WHERE member_id = ${memberId}`))

export const forgetSlackPerson = (
  memberId: MemberId,
  because: 'deactivated' | 'slack_deactivated',
  actorId: MemberId | null,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    if (!(yield* unlinkSlackPerson(memberId))) return
    yield* recordAudit('slack.person.unlinked', { actorId, targetId: memberId, detail: { because } })
  })

export const offerSlackLink = (
  slack: WorkingSlack,
  user: SlackUser,
  place: { readonly channel: string; readonly threadTs?: string },
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const linked = yield* slackPersonBySlackUser(user.id)
    const texts = slackTextsIn(linked === null ? null : yield* chosenLocaleOf(linked.member_id))
    const text = !isEligible(slack, user)
      ? texts.membersOnly(slack.workspace.team_name)
      : linked !== null
        ? texts.alreadyLinked(user.name)
        : texts.linkOffered(linkUrl(env, yield* transact(makeCode(user, null))))
    yield* calling('chat.postEphemeral', slack.api.postEphemeral({ ...place, user: user.id, text }))
  })

export const slackPersonOf = (memberId: MemberId): T.Task<SlackPersonRow | null, never, AppEnv> =>
  first<SlackPersonRow>(sql`SELECT * FROM slack_people WHERE member_id = ${memberId}`)

export const slackPersonBySlackUser = (slackUserId: string): T.Task<SlackPersonRow | null, never, AppEnv> =>
  first<SlackPersonRow>(sql`SELECT * FROM slack_people WHERE slack_user_id = ${slackUserId}`)

const isEligible = (slack: WorkingSlack, user: SlackUser): boolean =>
  user.isFullMember && (user.teamId === null || user.teamId === slack.workspace.team_id)

export const calling = <A>(
  method: string,
  call: T.Task<A, SlackCallFailure, AppEnv>,
): T.Task<A | undefined, never, AppEnv> =>
  T.catchAll((failure: SlackCallFailure) => T.as(undefined)(slackCallFailed(method, failure)))(call)

export interface SlackPersonRow {
  readonly member_id: MemberId
  readonly slack_user_id: string
  readonly slack_name: string
  readonly linked_at: number
}

const NOT_CONNECTED = 'Slack is not connected on this server.'
const CODE_GONE = 'This link is no longer valid. Ask for a new one.'
const REQUEST_SPACING_MS = 60_000

const makeCode = (user: SlackUser, memberId: MemberId | null): T.Task<string, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const code = env.random.secret()
    const now = env.clock.now()
    yield* run(sql`DELETE FROM slack_codes WHERE expires_at < ${now}`)
    yield* run(
      insertInto('slack_codes', {
        code_hash: hashSecret(code),
        kind: 'person',
        member_id: memberId,
        slack_user_id: user.id,
        slack_name: user.name.slice(0, NAME_MAX),
        created_at: now,
        expires_at: now + SLACK_CODE_LIFETIME_MS,
        used_at: null,
      }),
    )
    return code
  })

const usableCode = (memberId: MemberId, code: string): T.Task<CodeRow, NotFound, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const row = yield* first<CodeRow>(sql`SELECT * FROM slack_codes WHERE code_hash = ${hashSecret(code)}`)
    const usable =
      row !== null &&
      row.used_at === null &&
      Number(row.expires_at) > env.clock.now() &&
      (row.member_id === null || row.member_id === memberId)
    return usable ? row : yield* T.fail(NotFound({ message: CODE_GONE }))
  })

const linkUrl = (env: AppEnv, code: string): string => `${env.config.publicUrl}/${slackCodeHref(code)}`

const NAME_MAX = 200

interface CodeRow {
  readonly code_hash: string
  readonly kind: string
  readonly member_id: MemberId | null
  readonly slack_user_id: string
  readonly slack_name: string
  readonly expires_at: number
  readonly used_at: number | null
}
