import { Task as T } from '@homingbird/kernel'
import type { MemberId } from '@homingbird/protocol'
import { chosenLocaleOf } from '../domain/members.ts'
import type { AppEnv } from '../environment.ts'
import { calling, slackPersonOf } from './slack-people.ts'
import { slackTextsIn } from './slack-texts.ts'
import { workingSlack } from './slack-workspace.ts'

/** Rule 2: nothing of the draft but a link to its card, and only to a person who may decide it. */
export const sendSlackReviewRequest = (memberId: MemberId, cardPath: string): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const slack = yield* workingSlack
    if (slack === null) return
    const person = yield* slackPersonOf(memberId)
    if (person === null) return
    const direct = yield* calling('conversations.open', slack.api.openDirect(person.slack_user_id))
    if (direct === undefined) return
    const text = slackTextsIn(yield* chosenLocaleOf(memberId)).reviewWaiting(
      `${env.config.publicUrl}/${cardPath.replace(/^\//, '')}`,
    )
    const posted = yield* calling('chat.postMessage', slack.api.postMessage({ channel: direct, text }))
    if (posted !== undefined) env.log.emit({ name: 'slack.review_request_sent', attributes: { memberId } })
  })
