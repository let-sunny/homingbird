import { Task as T } from '@homingbird/kernel'
import { GENERAL_TOPIC, type Topic } from '@homingbird/protocol'
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
        ? `No topic matches. Ask in #${GENERAL_TOPIC}.`
        : [
            ...listed.topics.map(topicLine),
            '',
            `Ask one topic: homingbird draft --topic <slug> "<question>". When none fits, use ${GENERAL_TOPIC}.`,
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

const PRIVATE_NOTICE =
  'A private topic is seen only by its members, and only they can ask there: never mention one, or anything said in it, outside it.'
