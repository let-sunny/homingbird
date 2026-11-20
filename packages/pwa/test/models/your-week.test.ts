import { describe, expect, it } from 'vitest'
import { yourWeekModel } from '../../src/models/your-week.ts'
import { durationOf, strings } from '../../src/strings.ts'
import { report } from '../support/fixtures.ts'

describe('yourWeekModel', () => {
  it('shows nothing until the report has the week, and nothing for a report that failed', () => {
    expect(yourWeekModel(null)).toBeNull()
    expect(yourWeekModel('failed')).toBeNull()
    expect(yourWeekModel(report())).toBeNull()
  })

  it('gives each figure of the last 7 days beside the 7 days before', () => {
    const model = yourWeekModel(
      report({
        week: {
          days: 7,
          current: { notesSent: 12, repliesReceived: 4, medianReplyMs: 2 * 60 * 60_000 },
          previous: { notesSent: 3, repliesReceived: 0, medianReplyMs: null },
        },
      }),
    )
    expect(model).toEqual({
      title: strings.measures.weekTitle,
      intro: strings.measures.weekIntro,
      rows: [
        {
          label: strings.measures.weekNotesSent,
          value: strings.measures.weekValue({ now: '12', before: '3' }),
        },
        {
          label: strings.measures.weekRepliesReceived,
          value: strings.measures.weekValue({ now: '4', before: '0' }),
        },
        {
          label: strings.measures.weekMedianReply,
          value: strings.measures.weekValue({ now: durationOf(7_200_000), before: strings.trust.noneYet }),
        },
      ],
      footnote: strings.measures.weekReplyExplained,
    })
  })
})
