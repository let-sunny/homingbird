import type { AsRead, ConversationId, MemberId, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { channelDecisionsModel } from '../../src/models/channel-decisions.ts'
import { correctionPrefill } from '../../src/models/channel-teaching.ts'
import { timeShown } from '../../src/models/time.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CHANNEL_ROOM, everything, member, serverInfo } from '../support/fixtures.ts'
import { CHECKING } from '../support/resource-load.ts'

const NOW = Date.UTC(2026, 10, 19, 12)
const AGENT = 'Billing helper'
const ASKED = 'note_question0000' as NoteId
const ANSWER = 'note_answer000000' as NoteId

type Decision = AsRead.ChannelDecisions['decisions'][number]

const decision = (fields: Partial<Decision> = {}): Decision => ({
  noteId: ANSWER,
  conversationId: CHANNEL_ROOM,
  privately: false,
  outcome: 'sent_as_written',
  decidedBy: ANA,
  decidedAt: NOW - 60_000,
  question: { id: ASKED, authorId: BEN, body: 'Can I get a refund twice?' },
  answer: 'Yes, refunds are automatic.',
  agentAnswer: null,
  reason: null,
  principles: [],
  ...fields,
})

const listed = (decisions: ReadonlyArray<Decision>): AsRead.ChannelDecisions => ({
  channel: 'billing',
  days: 30,
  decisions,
})

const members = new Map<MemberId, AsRead.Member>([
  [ANA, member(ANA, 'June Park')],
  [BEN, member(BEN, 'Ben Okafor')],
])

const modelOf = (decisions: ReadonlyArray<Decision>, info: AsRead.ServerInfo | null = everything()) =>
  channelDecisionsModel(listed(decisions), null, { agent: AGENT, members, serverInfo: info, now: NOW })

const rowsOf = (decisions: ReadonlyArray<Decision>, info?: AsRead.ServerInfo | null) => {
  const model = modelOf(decisions, info)
  if (model.kind !== 'decisions') throw new Error('expected decisions')
  return model.rows
}

describe('channelDecisionsModel', () => {
  it('shows nothing to someone who does not manage the channel, and waits until that is known', () => {
    const context = { agent: AGENT, members, serverInfo: everything(), now: NOW }
    expect(channelDecisionsModel(null, null, context)).toEqual({ kind: 'hidden' })
    expect(channelDecisionsModel(null, CHECKING, context)).toEqual({ kind: 'waiting', wait: CHECKING })
    expect(channelDecisionsModel(listed([]), CHECKING, context).kind).toBe('waiting')
  })

  it('names the list, its period and who sees it, and says when nothing was decided', () => {
    const words = { agent: AGENT, channel: '#billing', days: 30 }
    expect(modelOf([])).toEqual({
      kind: 'decisions',
      title: strings.channelDecisions.title,
      intro: strings.channelDecisions.intro(words),
      none: strings.channelDecisions.none(words),
      listLabel: strings.channelDecisions.listLabel({ agent: AGENT }),
      rows: [],
    })
    expect(modelOf([decision()])).toMatchObject({ none: null })
  })

  it('shows an answer sent as written with who sent it, when, the question and a link to it', () => {
    expect(rowsOf([decision()])).toEqual([
      {
        key: ANSWER,
        outcome: 'sent_as_written',
        label: strings.channelDecisions.outcome.sent_as_written,
        decidedBy: strings.channelDecisions.decidedBy.sent_as_written({ name: 'June Park' }),
        time: timeShown(NOW - 60_000, NOW),
        privately: null,
        question: {
          from: strings.channelAgent.questionFrom({ name: 'Ben Okafor' }),
          body: 'Can I get a refund twice?',
        },
        answer: { label: strings.channelDecisions.answerSent, body: 'Yes, refunds are automatic.' },
        original: null,
        reason: null,
        principles: null,
        open: {
          href: `#/c/${CHANNEL_ROOM}?note=${ANSWER}`,
          label: strings.channelDecisions.open,
        },
        teach: { label: strings.channelTeach.add({ agent: AGENT }), prefill: null },
      },
    ])
  })

  it('sets the agent’s own words beside an edit, and teaches from the correction', () => {
    const [row] = rowsOf([
      decision({
        outcome: 'sent_edited',
        answer: 'Duplicate refunds over 200 EUR need Ana.',
        agentAnswer: 'Yes, refunds are automatic.',
      }),
    ])
    expect(row!.decidedBy).toBe(strings.channelDecisions.decidedBy.sent_edited({ name: 'June Park' }))
    expect(row!.original).toEqual({
      label: strings.channelDecisions.agentWrote({ agent: AGENT }),
      body: 'Yes, refunds are automatic.',
    })
    const prefill = correctionPrefill(
      'Yes, refunds are automatic.',
      { kind: 'edit', body: 'Duplicate refunds over 200 EUR need Ana.' },
      'billing',
    )
    expect(row!.teach).toEqual({ label: prefill.label, prefill })
  })

  it('offers plain teaching for an edited answer whose original this client was not given', () => {
    const [row] = rowsOf([decision({ outcome: 'sent_edited', agentAnswer: null })])
    expect(row!.teach).toEqual({ label: strings.channelTeach.add({ agent: AGENT }), prefill: null })
  })

  it('shows a discard with its reason, links to the question it left unanswered, and teaches what to do instead', () => {
    const [row] = rowsOf([
      decision({ outcome: 'discarded', reason: 'Policy changed in October.', privately: true }),
    ])
    expect(row).toMatchObject({
      label: strings.channelDecisions.outcome.discarded,
      decidedBy: strings.channelDecisions.decidedBy.discarded({ name: 'June Park' }),
      privately: strings.channelAgent.askedPrivately,
      answer: { label: strings.channelDecisions.answerDiscarded },
      reason: { label: strings.channelDecisions.reason, body: 'Policy changed in October.' },
      open: { href: `#/c/${CHANNEL_ROOM}?note=${ASKED}` },
    })
    const prefill = correctionPrefill('Yes, refunds are automatic.', { kind: 'discard' }, 'billing')
    expect(row!.teach).toEqual({ label: prefill.label, prefill })
  })

  it('says a manager discarded it when who is not known, and opens the conversation when the question is gone', () => {
    const [row] = rowsOf([decision({ outcome: 'discarded', decidedBy: null, question: null })])
    expect(row!.decidedBy).toBe(strings.channelDecisions.discardedByAManager)
    expect(row!.question).toBeNull()
    expect(row!.open.href).toBe(`#/c/${CHANNEL_ROOM}`)
  })

  it('names a former member, lists the principles applied, and links a sent answer without its question', () => {
    const [row] = rowsOf([
      decision({
        decidedBy: 'mem_gone00000000' as MemberId,
        question: null,
        conversationId: 'conv_other0000000' as ConversationId,
        principles: [
          { id: 'prin_refunds000000' as never, topic: 'Refund window' },
          { id: 'prin_invoices00000' as never, topic: 'Invoices' },
        ],
      }),
    ])
    expect(row!.decidedBy).toBe(
      strings.channelDecisions.decidedBy.sent_as_written({ name: strings.formerMember }),
    )
    expect(row!.principles).toBe(
      strings.channelDecisions.principles({ principles: 'Refund window and Invoices' }),
    )
    expect(row!.open.href).toBe(`#/c/conv_other0000000?note=${ANSWER}`)
  })

  it('shows an outcome this client does not know without offering to teach from it', () => {
    const [row] = rowsOf([decision({ outcome: 'unknown' })])
    expect(row!.label).toBe(strings.channelDecisions.outcome.unknown)
    expect(row!.teach).toBeNull()
  })

  it('offers no teaching while the organization keeps teaching off', () => {
    expect(rowsOf([decision()], serverInfo({ teaching: false }))[0]!.teach).toBeNull()
  })
})
