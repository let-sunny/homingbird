import type { AsRead } from '@homingbird/protocol'
import { durationOf, formats, strings } from '../strings.ts'

/** The person's own week of notes, beyond their agent: nothing until the report has it. */
export const yourWeekModel = (report: AsRead.AgentReport | 'failed' | null): YourWeekModel | null => {
  if (report === null || report === 'failed' || report.week === undefined) return null
  const { current, previous } = report.week
  const approvedNow = current.approvedForChannels ?? 0
  const approvedBefore = previous.approvedForChannels ?? 0
  const count = (value: number): string => formats.decimal.format(value)
  const time = (ms: number | null): string => (ms === null ? strings.trust.noneYet : durationOf(ms))
  const row = (label: string, now: string, before: string) => ({
    label,
    value: strings.measures.weekValue({ now, before }),
  })
  return {
    title: strings.measures.weekTitle,
    intro: strings.measures.weekIntro,
    rows: [
      row(strings.measures.weekNotesSent, count(current.notesSent), count(previous.notesSent)),
      row(
        strings.measures.weekRepliesReceived,
        count(current.repliesReceived),
        count(previous.repliesReceived),
      ),
      row(strings.measures.weekMedianReply, time(current.medianReplyMs), time(previous.medianReplyMs)),
      ...(approvedNow + approvedBefore > 0
        ? [row(strings.measures.weekApprovedForChannels, count(approvedNow), count(approvedBefore))]
        : []),
    ],
    footnote: strings.measures.weekReplyExplained,
  }
}

export interface YourWeekModel {
  readonly title: string
  readonly intro: string
  readonly rows: ReadonlyArray<{ readonly label: string; readonly value: string }>
  readonly footnote: string
}
