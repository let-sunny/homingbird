import { type HasClock, Schema as S, Task as T, tagged } from '@homingbird/kernel'
import type { Fetch } from '../auth/identity-provider.ts'

/**
 * The Slack Web API methods Dovecote calls, with the server's bot token. Posting is reached only from a
 * person's approval or a content-free notice (rules 1 and 2).
 */
export const makeSlackApi = (fetch: Fetch, token: string): SlackApi => {
  const call = <A>(method: SlackMethod, answer: S.Schema<A>, fields: Fields) =>
    callSlack(fetch, token, method, answer, fields)
  return {
    authTest: () =>
      T.map((answer: S.Infer<typeof IdentityAnswer>) => ({
        teamId: answer.team_id,
        team: answer.team ?? null,
        userId: answer.user_id,
        botId: answer.bot_id ?? null,
      }))(call('auth.test', IdentityAnswer, {})),
    postMessage: (message) =>
      T.map((answer: S.Infer<typeof PostedAnswer>) => ({ channel: answer.channel, ts: answer.ts }))(
        call('chat.postMessage', PostedAnswer, {
          channel: message.channel,
          text: message.text,
          thread_ts: message.threadTs,
          unfurl_links: 'false',
          unfurl_media: 'false',
        }),
      ),
    postEphemeral: (message) =>
      T.asUnit(
        call('chat.postEphemeral', Anything, {
          channel: message.channel,
          user: message.user,
          text: message.text,
          thread_ts: message.threadTs,
        }),
      ),
    openDirect: (user) =>
      T.map((answer: S.Infer<typeof OpenedAnswer>) => answer.channel.id)(
        call('conversations.open', OpenedAnswer, { users: user }),
      ),
    userInfo: (user) =>
      T.map((answer: S.Infer<typeof UserAnswer>) => slackUserOf(answer.user))(
        call('users.info', UserAnswer, { user }),
      ),
    userByEmail: (email) =>
      T.catchAll((failure: SlackCallFailure) =>
        failure._tag === 'SlackRefused' && failure.error === 'users_not_found'
          ? T.succeed(null)
          : T.fail(failure),
      )(
        T.map((answer: S.Infer<typeof UserAnswer>): SlackUser | null => slackUserOf(answer.user))(
          call('users.lookupByEmail', UserAnswer, { email }),
        ),
      ),
    channelInfo: (channel) =>
      T.map((answer: S.Infer<typeof ChannelAnswer>) => ({
        id: answer.channel.id,
        name: answer.channel.name ?? answer.channel.id,
        isPrivate: answer.channel.is_private ?? false,
        isExternal: answer.channel.is_ext_shared ?? false,
        isArchived: answer.channel.is_archived ?? false,
        memberCount: answer.channel.num_members ?? null,
      }))(call('conversations.info', ChannelAnswer, { channel, include_num_members: 'true' })),
    threadReplies: (channel, ts) =>
      T.map((answer: S.Infer<typeof RepliesAnswer>) =>
        answer.messages.map((message) => ({
          ts: message.ts,
          user: message.user ?? null,
          botId: message.bot_id ?? null,
          text: message.text ?? '',
        })),
      )(call('conversations.replies', RepliesAnswer, { channel, ts, limit: String(THREAD_PAGE) })),
    addReaction: (channel, ts, name) =>
      T.catchAll((failure: SlackCallFailure) =>
        failure._tag === 'SlackRefused' && failure.error === 'already_reacted' ? T.unit : T.fail(failure),
      )(T.asUnit(call('reactions.add', Anything, { channel, timestamp: ts, name }))),
  }
}

export interface SlackApi {
  readonly authTest: () => SlackCall<SlackIdentity>
  readonly postMessage: (message: SlackMessage) => SlackCall<SlackPosted>
  readonly postEphemeral: (message: SlackMessage & { readonly user: string }) => SlackCall<void>
  /** The direct message channel between the app and one user. */
  readonly openDirect: (user: string) => SlackCall<string>
  readonly userInfo: (user: string) => SlackCall<SlackUser>
  /** Null when no user of the workspace has that address, or that user is deactivated. */
  readonly userByEmail: (email: string) => SlackCall<SlackUser | null>
  readonly channelInfo: (channel: string) => SlackCall<SlackChannel>
  /** The first page of a thread, its parent first. */
  readonly threadReplies: (channel: string, ts: string) => SlackCall<ReadonlyArray<SlackThreadMessage>>
  readonly addReaction: (channel: string, ts: string, name: string) => SlackCall<void>
}

export type SlackCall<A> = T.Task<A, SlackCallFailure, HasClock>

export interface SlackMessage {
  readonly channel: string
  readonly text: string
  readonly threadTs?: string
}

export interface SlackPosted {
  readonly channel: string
  readonly ts: string
}

export interface SlackIdentity {
  readonly teamId: string
  readonly team: string | null
  readonly userId: string
  readonly botId: string | null
}

/** A full member of the workspace may ask; a guest, someone from another organization or a bot may not. */
export interface SlackUser {
  readonly id: string
  readonly teamId: string | null
  readonly name: string
  readonly email: string | null
  readonly isFullMember: boolean
  readonly deleted: boolean
}

export interface SlackChannel {
  readonly id: string
  readonly name: string
  readonly isPrivate: boolean
  readonly isExternal: boolean
  readonly isArchived: boolean
  readonly memberCount: number | null
}

export interface SlackThreadMessage {
  readonly ts: string
  readonly user: string | null
  readonly botId: string | null
  readonly text: string
}

export type SlackUnreachable = ReturnType<typeof SlackUnreachable>

export type SlackRateLimited = ReturnType<typeof SlackRateLimited>

export type SlackRefused = ReturnType<typeof SlackRefused>

export type SlackCallFailure = SlackUnreachable | SlackRateLimited | SlackRefused

export type SlackMethod =
  | 'auth.test'
  | 'chat.postMessage'
  | 'chat.postEphemeral'
  | 'conversations.open'
  | 'conversations.info'
  | 'conversations.replies'
  | 'users.info'
  | 'users.lookupByEmail'
  | 'reactions.add'

/** Slack's codes that mean the token was refused, whatever was called. */
export const isTokenRefusal = (failure: SlackCallFailure): boolean =>
  failure._tag === 'SlackRefused' && TOKEN_REFUSALS.has(failure.error)

/** Slack shows `&`, `<` and `>` as special forms; escaped, a mention, a channel ping or a masked link is text. */
export const escapeSlackText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const SLACK_API = 'https://slack.com/api/'
export const SLACK_CALL_TIMEOUT_MS = 10_000

type Fields = Readonly<Record<string, string | undefined>>

/** The token goes to slack.com only: a redirect fails, and no failure carries the token or the body. */
const callSlack = <A>(
  fetch: Fetch,
  token: string,
  method: SlackMethod,
  answer: S.Schema<A>,
  fields: Fields,
): T.Task<A, SlackCallFailure, HasClock> =>
  T.catchAll((error: SlackCallFailure | { readonly _tag: 'TimeoutError' }) =>
    T.fail(error._tag === 'TimeoutError' ? SlackUnreachable({ method }) : error),
  )(
    T.timeout(SLACK_CALL_TIMEOUT_MS)(
      T.gen(function* () {
        const response = yield* T.tryPromise(
          (signal) =>
            fetch(`${SLACK_API}${method}`, {
              method: 'POST',
              redirect: 'error',
              headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
              },
              body: formOf(fields),
              signal,
            }),
          () => SlackUnreachable({ method }),
        )
        if (response.status === 429)
          return yield* T.fail(
            SlackRateLimited({
              method,
              retryAfterSeconds: retryAfterOf(response.headers.get('retry-after')),
            }),
          )
        if (!response.ok) return yield* T.fail(SlackUnreachable({ method }))
        const json: unknown = yield* T.tryPromise(
          () => response.json(),
          () => SlackUnreachable({ method }),
        )
        const verdict = Verdict.decode(json)
        if (verdict._tag === 'Err') return yield* T.fail(SlackUnreachable({ method }))
        if (!verdict.value.ok)
          return yield* T.fail(SlackRefused({ method, error: verdict.value.error ?? 'unknown_error' }))
        const decoded = answer.decode(json)
        if (decoded._tag === 'Err') return yield* T.fail(SlackUnreachable({ method }))
        return decoded.value
      }),
    ),
  )

const formOf = (fields: Fields): string =>
  new URLSearchParams(
    Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ).toString()

const SlackUnreachable = tagged('SlackUnreachable')<{ readonly method: SlackMethod }>()

const SlackRateLimited = tagged('SlackRateLimited')<{
  readonly method: SlackMethod
  readonly retryAfterSeconds: number
}>()

const SlackRefused = tagged('SlackRefused')<{ readonly method: SlackMethod; readonly error: string }>()

const retryAfterOf = (header: string | null): number => {
  const seconds = header === null ? Number.NaN : Number(header)
  return Number.isInteger(seconds) && seconds > 0 ? Math.min(seconds, MAX_RETRY_AFTER_SECONDS) : 1
}

const slackUserOf = (user: S.Infer<typeof UserShape>): SlackUser => ({
  id: user.id,
  teamId: user.team_id ?? null,
  name: nonEmpty(user.profile?.display_name) ?? nonEmpty(user.real_name) ?? nonEmpty(user.name) ?? user.id,
  email: user.profile?.email ?? null,
  isFullMember:
    user.is_bot !== true &&
    user.deleted !== true &&
    user.is_restricted !== true &&
    user.is_ultra_restricted !== true &&
    user.is_stranger !== true &&
    user.is_app_user !== true,
  deleted: user.deleted === true,
})

const nonEmpty = (text: string | undefined): string | undefined =>
  text === undefined || text.trim() === '' ? undefined : text

const MAX_RETRY_AFTER_SECONDS = 3600
const THREAD_PAGE = 200

const TOKEN_REFUSALS = new Set([
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
  'no_permission',
])

const SlackCode = S.string({ maxLength: 200 })
const SlackId = S.string({ minLength: 1, maxLength: 64 })
const SlackText = S.string({ maxLength: 200 })

const Verdict = S.struct({ ok: S.boolean, error: S.optional(SlackCode) })

const Anything = S.struct({})

const PostedAnswer = S.struct({ channel: SlackId, ts: SlackId })

const OpenedAnswer = S.struct({ channel: S.struct({ id: SlackId }) })

const IdentityAnswer = S.struct({
  team_id: SlackId,
  team: S.optional(SlackText),
  user_id: SlackId,
  bot_id: S.optional(SlackId),
})

const UserShape = S.struct({
  id: SlackId,
  team_id: S.optional(SlackId),
  name: S.optional(SlackText),
  real_name: S.optional(SlackText),
  deleted: S.optional(S.boolean),
  is_bot: S.optional(S.boolean),
  is_app_user: S.optional(S.boolean),
  is_restricted: S.optional(S.boolean),
  is_ultra_restricted: S.optional(S.boolean),
  is_stranger: S.optional(S.boolean),
  profile: S.optional(
    S.struct({ display_name: S.optional(SlackText), email: S.optional(S.string({ maxLength: 320 })) }),
  ),
})

const UserAnswer = S.struct({ user: UserShape })

const ChannelAnswer = S.struct({
  channel: S.struct({
    id: SlackId,
    name: S.optional(SlackText),
    is_private: S.optional(S.boolean),
    is_ext_shared: S.optional(S.boolean),
    is_archived: S.optional(S.boolean),
    num_members: S.optional(S.int({ min: 0 })),
  }),
})

const RepliesAnswer = S.struct({
  messages: S.array(
    S.struct({
      ts: SlackId,
      user: S.optional(SlackId),
      bot_id: S.optional(SlackId),
      text: S.optional(S.string({ maxLength: 100_000 })),
    }),
    { maxItems: 1000 },
  ),
})
