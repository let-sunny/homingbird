import type { AsRead } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { postsToText, slackAskerOf, slackReplyLines } from '../../src/models/slack-reply.ts'
import { strings } from '../../src/strings.ts'
import { note } from '../support/fixtures.ts'

const VIA: NonNullable<AsRead.Note['via']> = {
  tool: 'slack',
  askerName: 'Pat Rivera',
  askerId: null,
  channelName: 'eng-help',
  edited: false,
  deleted: false,
  threadAt: '1.0',
  newerMessages: 0,
}

const LINK: NonNullable<AsRead.Channel['link']> = {
  tool: 'slack',
  name: 'eng-help',
  isPrivate: false,
  memberCount: 42,
  state: 'active',
}

const question = (via: Partial<typeof VIA> = {}, updatedAt = 10) =>
  note('note_q', { origin: 'outside', updatedAt, via: { ...VIA, ...via } })

describe('slackReplyLines', () => {
  it('says where a reply is posted, with the Slack channel’s members when the link counts them', () => {
    expect(slackReplyLines(question(), LINK, 20)).toEqual({
      postsTo: strings.slack.postsTo({ channel: 'eng-help', count: 42 }),
      newer: null,
      edited: null,
    })
    expect(slackReplyLines(question(), null, 20)?.postsTo).toBe(
      strings.slack.postsToUncounted({ channel: 'eng-help' }),
    )
  })

  it('counts the messages that came in the thread since', () => {
    expect(slackReplyLines(question({ newerMessages: 3 }), LINK, 20)?.newer).toBe(
      strings.slack.newerMessages({ count: 3 }),
    )
  })

  it('says the question was edited only when the edit came after the reply was drafted', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (edited, drafted) => {
        const lines = slackReplyLines(question({ edited: true }, edited), LINK, drafted)
        expect(lines?.edited).toBe(edited > drafted ? strings.slack.questionEdited : null)
      }),
    )
    expect(slackReplyLines(question({ edited: false }, 50), LINK, 10)?.edited).toBeNull()
    expect(slackReplyLines(question({ edited: true }, 50), LINK, null)?.edited).toBeNull()
  })

  it('says nothing for a reply to a question that did not come from Slack, or to none', () => {
    expect(slackReplyLines(note('note_m'), LINK, 20)).toBeNull()
    expect(slackReplyLines(null, LINK, 20)).toBeNull()
    expect(slackReplyLines(undefined, LINK, 20)).toBeNull()
  })
})

describe('postsToText', () => {
  it('leaves out a count the link does not know', () => {
    expect(postsToText('eng-help', { ...LINK, memberCount: null })).toBe(
      strings.slack.postsToUncounted({ channel: 'eng-help' }),
    )
    expect(postsToText('eng-help', LINK)).toBe(strings.slack.postsTo({ channel: 'eng-help', count: 42 }))
  })
})

describe('slackAskerOf', () => {
  it('names a Slack asker as Slack does, marked as from Slack, and nobody else', () => {
    expect(slackAskerOf(question())).toBe('Pat Rivera, in Slack #eng-help')
    expect(slackAskerOf(note('note_m'))).toBeNull()
    expect(slackAskerOf(null)).toBeNull()
  })
})
