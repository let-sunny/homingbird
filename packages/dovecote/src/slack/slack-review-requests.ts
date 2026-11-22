import { Task as T } from '@homingbird/kernel'
import type { MemberId } from '@homingbird/protocol'
import { chosenLocaleOf } from '../domain/members.ts'
import type { AppEnv } from '../environment.ts'
import { calling, slackPersonOf } from './slack-people.ts'
import { type SlackTexts, slackTextsIn } from './slack-texts.ts'
import { workingSlack } from './slack-workspace.ts'

/** Rule 2: nothing of the draft but a link to its card, and only to a person who may decide it. */
export const sendSlackReviewRequest = (memberId: MemberId, cardPath: string): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const sent = yield* sendDirect(memberId, cardPath, (texts) => texts.reviewWaiting)
    if (sent) env.log.emit({ name: 'slack.review_request_sent', attributes: { memberId } })
  })

/** Tells the sender or a manager that a reply was not posted to Slack, with a link to it and nothing of it. */
export const sendSlackNotPosted = (memberId: MemberId, notePath: string): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const sent = yield* sendDirect(memberId, notePath, (texts) => texts.notPosted)
    if (sent) env.log.emit({ name: 'slack.not_posted_told', attributes: { memberId } })
  })

const sendDirect = (
  memberId: MemberId,
  path: string,
  textOf: (texts: SlackTexts) => (url: string) => string,
): T.Task<boolean, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const slack = yield* workingSlack
    if (slack === null) return false
    const person = yield* slackPersonOf(memberId)
    if (person === null) return false
    const direct = yield* calling('conversations.open', slack.api.openDirect(person.slack_user_id))
    if (direct === undefined) return false
    const text = textOf(slackTextsIn(yield* chosenLocaleOf(memberId)))(
      `${env.config.publicUrl}/${path.replace(/^\//, '')}`,
    )
    return (
      (yield* calling('chat.postMessage', slack.api.postMessage({ channel: direct, text }))) !== undefined
    )
  })
