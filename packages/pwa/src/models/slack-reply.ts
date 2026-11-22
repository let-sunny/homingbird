import type { AsRead } from '@homingbird/protocol'
import { strings } from '../strings.ts'

/**
 * What a reply to a question from Slack says before it is sent, on a draft card, a review card and in the
 * composer: where it is posted, how many messages came in the thread since, and whether the question was
 * edited in Slack after the reply was drafted. `drafted` is when the reply last changed; null while typed.
 */
export const slackReplyLines = (
  question: AsRead.Note | null | undefined,
  link: AsRead.Channel['link'] | null | undefined,
  drafted: number | null,
): SlackReplyLines | null => {
  if (question == null || question.via === undefined) return null
  const via = question.via
  return {
    postsTo: postsToText(via.channelName, link),
    newer: via.newerMessages > 0 ? strings.slack.newerMessages({ count: via.newerMessages }) : null,
    edited:
      via.edited && drafted !== null && question.updatedAt > drafted ? strings.slack.questionEdited : null,
  }
}

/** "Posts to Slack #billing-help (12 members)", with the count when the link knows it. */
export const postsToText = (channel: string, link: AsRead.Channel['link'] | null | undefined): string => {
  const count = link?.memberCount ?? null
  return count === null
    ? strings.slack.postsToUncounted({ channel })
    : strings.slack.postsTo({ channel, count })
}

/** Whom a question from Slack is from, named as Slack names them: "Pat Rivera, in Slack #eng-help". */
export const slackAskerOf = (question: AsRead.Note | null | undefined): string | null =>
  question?.via === undefined
    ? null
    : strings.slack.askedIn({ name: question.via.askerName, channel: question.via.channelName })

export interface SlackReplyLines {
  readonly postsTo: string
  readonly newer: string | null
  readonly edited: string | null
}
