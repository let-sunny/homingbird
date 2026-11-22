import type { AsRead, MemberId, NoteId } from '@homingbird/protocol'
import { lifetime } from '@homingbird/ui'
import { getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { channelDecisionsSection } from '../../src/views/channel-decisions.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import {
  ANA,
  BEN,
  CHANNEL_ROOM,
  channel,
  draft,
  entry,
  everything,
  member,
  serverInfo,
} from '../support/fixtures.ts'

usingFakeDom()

const AGENT = 'mem_agent0000000' as MemberId
const billing = channel('billing', {
  joined: true,
  managing: true,
  runsAgent: true,
  agent: { id: AGENT, name: 'Billing helper' },
})

type Decision = AsRead.ChannelDecisions['decisions'][number]

const decision = (fields: Partial<Decision> = {}): Decision => ({
  noteId: 'note_answer000000' as NoteId,
  conversationId: CHANNEL_ROOM,
  privately: false,
  outcome: 'discarded',
  decidedBy: ANA,
  decidedAt: Date.UTC(2026, 10, 19, 11),
  question: { id: 'note_question0000' as NoteId, authorId: BEN, body: 'Can I get a refund twice?' },
  answer: 'Yes, refunds are automatic.',
  agentAnswer: null,
  reason: 'Policy changed in October.',
  principles: [{ id: 'prin_refunds000000' as never, topic: 'Refund window' }],
  ...fields,
})

const listed = (decisions: ReadonlyArray<Decision>): AsRead.ChannelDecisions => ({
  channel: 'billing',
  days: 30,
  decisions,
})

const shown = (info: AsRead.ServerInfo = everything()) => {
  const { context, called } = testContext()
  context.state.serverInfo.set(info)
  context.state.directory.set([entry(ANA, 'June Park'), entry(BEN, 'Ben Okafor')])
  mount(dialogHost())
  const section = mount(channelDecisionsSection(context, lifetime(), billing))
  return { context, called, section }
}

describe('channelDecisionsSection', () => {
  it('loads the channel’s decisions, waiting, and shows nothing to someone who does not manage it', () => {
    const { called, section } = shown()
    expect(called('loadChannelDecisions')[0]!.args).toEqual(['billing'])
    expect(textOf(section)).toBe(strings.loading)
    called('loadChannelDecisions')[0]!.then!.done!(null)
    expect(textOf(section)).toBe('')
  })

  it('says when they could not be loaded, and when nothing was decided', () => {
    const { called, section } = shown()
    called('loadChannelDecisions')[0]!.then!.failed!(new Error('down'))
    expect(getByRole(section, 'status').textContent).toBe(strings.channelDecisions.loadFailed)
    called('loadChannelDecisions')[0]!.then!.done!(listed([]))
    expect(textOf(section)).toContain(strings.channelDecisions.none({ days: 30 }))
    expect(queryByRole(section, 'list')).toBeNull()
  })

  it('shows each decision with its question, the answer, the reason and the principles, and links to it', () => {
    const { called, section } = shown()
    called('loadChannelDecisions')[0]!.then!.done!(listed([decision()]))
    expect(getByRole(section, 'heading', { name: strings.channelDecisions.title })).toBeTruthy()
    const list = getByRole(section, 'list', {
      name: strings.channelDecisions.listLabel({ agent: 'Billing helper' }),
    })
    const row = list.querySelector<HTMLElement>('.decision-row')!
    expect(row.className).toContain('is-discarded')
    const text = textOf(row)
    expect(text).toContain(strings.channelDecisions.outcome.discarded)
    expect(text).toContain(strings.channelDecisions.decidedBy.discarded({ name: 'June Park' }))
    expect(text).toContain('Can I get a refund twice?')
    expect(text).toContain('Yes, refunds are automatic.')
    expect(text).toContain('Policy changed in October.')
    expect(text).toContain(strings.channelDecisions.principles({ principles: 'Refund window' }))
    expect(row.querySelector('time')).not.toBeNull()
    expect(getByRole(row, 'link', { name: strings.channelDecisions.open }).getAttribute('href')).toBe(
      `#/c/${CHANNEL_ROOM}?note=note_question0000`,
    )
  })

  it('sets the agent’s words above an edited answer, and marks a private question', () => {
    const { called, section } = shown()
    called('loadChannelDecisions')[0]!.then!.done!(
      listed([
        decision({
          outcome: 'sent_edited',
          answer: 'Ask Ana.',
          agentAnswer: 'Yes, refunds are automatic.',
          reason: null,
          principles: [],
          privately: true,
        }),
      ]),
    )
    const row = section.querySelector<HTMLElement>('.decision-row')!
    expect(textOf(row.querySelector('.decision-original')!)).toContain('Yes, refunds are automatic.')
    expect(textOf(row.querySelector('.decision-answer')!)).toContain('Ask Ana.')
    expect(textOf(row)).toContain(strings.channelAgent.askedPrivately)
    expect(row.querySelector('.decision-reason, .decision-principles')).toBeNull()
  })

  it('opens the principle form prefilled from the decision, and offers no teaching while it is off', () => {
    const { called, section } = shown()
    called('loadChannelDecisions')[0]!.then!.done!(listed([decision()]))
    getByRole(section, 'button', { name: strings.channelTeach.fromDiscard }).click()
    const dialog = document.getElementById('dialog')!
    expect(textOf(dialog)).toContain(strings.channelTeach.dialogTitle({ agent: 'Billing helper' }))
    const off = shown(serverInfo({ channelAgents: true, teaching: false }))
    off.called('loadChannelDecisions')[0]!.then!.done!(listed([decision()]))
    expect(queryByRole(off.section, 'button', { name: strings.channelTeach.fromDiscard })).toBeNull()
  })

  it('reads them again when an answer in the channel is sent or discarded, keeping the latest request', () => {
    const { context, called, section } = shown()
    context.state.reviews.set([{ ...review(), channel: 'other' }])
    expect(called('loadChannelDecisions')).toHaveLength(1)
    context.state.reviews.set([{ ...review(), channel: 'billing' }])
    expect(called('loadChannelDecisions')).toHaveLength(2)
    const [first, second] = called('loadChannelDecisions')
    second!.then!.done!(listed([decision()]))
    first!.then!.done!(null)
    first!.then!.failed!(new Error('late'))
    expect(section.querySelector('.decision-row')).not.toBeNull()
  })
})

const review = (): AsRead.Review => ({
  note: draft('note_waiting00000', { authorId: AGENT }),
  question: null,
  channel: 'billing',
  agent: member(AGENT, 'Billing helper', { kind: 'channel_agent' }),
  privately: false,
})
