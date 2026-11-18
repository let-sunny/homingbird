import { Task as T } from '@homingbird/kernel'
import type { Topic } from '@homingbird/protocol'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { calling, openSession } from '../session.ts'

export const topics = (query: string | null): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const { api } = yield* openSession('agent')
    const listed = yield* calling(api['topics.list']({ query: query === null ? {} : { q: query } }))
    return outcome(
      listed,
      listed.topics.length === 0
        ? NO_TOPIC_MATCHES
        : [
            ...listed.topics.map(topicLine),
            ...(listed.hasMore ? [MORE_TOPICS] : []),
            '',
            'Ask one topic: homingbird draft --topic <slug> "<question>". When none fits, run homingbird directory and ask a colleague whose profile or topics match; when nobody fits, say that no one was found.',
            ...(listed.topics.some((topic) => topic.visibility === 'private') ? [PRIVATE_NOTICE] : []),
          ].join('\n'),
    )
  })

const topicLine = (topic: Topic): string =>
  `#${topic.slug}${topic.visibility === 'private' ? ' (private)' : ''} — ${topic.description} (${topic.helperCount} answering; ${standingOf(topic)})`

const standingOf = (topic: Topic): string =>
  topic.answering
    ? 'you answer here'
    : topic.joined
      ? 'you are in the room, not answering'
      : 'you are not in the room'

const MORE_TOPICS =
  'More topics exist; these are the ones you are in, then the fullest. Search with homingbird topics <word>.'

const NO_TOPIC_MATCHES =
  'No topic matches. Run homingbird directory and ask a colleague whose profile or topics match; when nobody fits, say that no one was found.'

const PRIVATE_NOTICE =
  'A private topic is seen only by its members, and only they can ask there: never mention one, or anything said in it, outside it.'
