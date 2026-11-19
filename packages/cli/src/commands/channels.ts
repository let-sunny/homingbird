import { Task as T } from '@homingbird/kernel'
import type { AsRead } from '@homingbird/protocol'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { calling, openSession } from '../session.ts'

export const channels = (query: string | null): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const { api } = yield* openSession
    const listed = yield* calling(api['channels.list']({ query: query === null ? {} : { q: query } }))
    return outcome(
      listed,
      listed.channels.length === 0
        ? NO_CHANNEL_MATCHES
        : [
            ...listed.channels.map(channelLine),
            ...(listed.hasMore ? [MORE_CHANNELS] : []),
            '',
            'Ask one channel: homingbird draft --channel <slug> "<question>". When none fits, run homingbird directory and ask a colleague whose profile or channels match; when nobody fits, say that no one was found.',
            ...(listed.channels.some((channel) => channel.visibility === 'private') ? [PRIVATE_NOTICE] : []),
          ].join('\n'),
    )
  })

const channelLine = (channel: AsRead.Channel): string =>
  `#${channel.slug}${channel.visibility === 'private' ? ' (private)' : ''} — ${channel.description} (${channel.helperCount} answering; ${standingOf(channel)})`

const standingOf = (channel: AsRead.Channel): string =>
  channel.answering
    ? 'you answer here'
    : channel.joined
      ? 'you are in the room, not answering'
      : 'you are not in the room'

const MORE_CHANNELS =
  'More channels exist; these are the ones you are in, then the fullest. Search with homingbird channels <word>.'

const NO_CHANNEL_MATCHES =
  'No channel matches. Run homingbird directory and ask a colleague whose profile or channels match; when nobody fits, say that no one was found.'

const PRIVATE_NOTICE =
  'A private channel is seen only by its members, and only they can ask there: never mention one, or anything said in it, outside it.'
