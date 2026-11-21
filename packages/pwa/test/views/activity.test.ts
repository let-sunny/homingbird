import type { AsRead, ConversationId, MemberId, NoteId } from '@homingbird/protocol'
import { lifetime } from '@homingbird/ui'
import {
  fakeEvent,
  getByRole,
  installFakeDom,
  isPopoverOpen,
  queryByRole,
  textOf,
} from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { ACTIVITY_PANEL_ID, activityBell, activityPanel, activityView } from '../../src/views/activity.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import {
  ANA,
  BEN,
  CHANNEL_ROOM,
  CY,
  ROOM,
  conversation,
  draft,
  entry,
  everything,
  me,
  member,
  note,
  summary,
} from '../support/fixtures.ts'

usingFakeDom()

const AGENT = 'mem_agent0000000' as MemberId

const review = (): AsRead.Review => ({
  note: draft('note_answer00000', {
    authorId: AGENT,
    conversationId: CHANNEL_ROOM,
    inReplyTo: 'note_question000' as NoteId,
  }),
  question: note('note_question000', { authorId: CY, conversationId: CHANNEL_ROOM, body: 'Where is it?' }),
  channel: 'payments',
  agent: member(AGENT, 'Payments helper', { kind: 'channel_agent' }),
  privately: false,
})

/** The bell and its panel, as the shell puts them on the page, with Ana signed in. */
const shown = () => {
  const test = testContext()
  const { state } = test.context
  state.session.set(me())
  state.serverInfo.set(everything())
  state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy')])
  state.conversations.set([
    conversation({ draftCount: 1 }),
    conversation({ id: CHANNEL_ROOM, kind: 'channel', title: 'payments', participantIds: [ANA, CY, AGENT] }),
  ])
  const life = lifetime()
  const dialog = mount(dialogHost())
  const bell = mount(activityBell(test.context, life, me()))
  const panel = mount(activityPanel(test.context, life, me()))
  const link = () => bell.querySelector('a')!
  return { ...test, state, life, dialog, bell, panel, link }
}

describe('activityBell', () => {
  it('says how many things wait, and opens the panel instead of leaving the page', () => {
    const { state, bell, panel, link, called } = shown()
    state.reviews.set([review()])
    expect(link().getAttribute('aria-label')).toBe(strings.activity.bell({ count: 2 }))
    expect(textOf(bell.querySelector('.activity-count')!)).toBe('2')
    expect(link().getAttribute('href')).toBe('#/activity')
    expect(link().dataset.tour).toBe('activity')
    expect(called('loadActivity')).toHaveLength(1)
    const click = fakeEvent('click') as unknown as Event
    link().dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(isPopoverOpen(panel as never)).toBe(true)
    link().click()
    expect(isPopoverOpen(panel as never)).toBe(false)
  })

  it('shows no count when nothing waits, and follows its address on the activity page', () => {
    const { state, bell, link, panel } = shown()
    state.conversations.set([])
    expect(bell.querySelector('.activity-count')).toBeNull()
    expect(link().getAttribute('aria-label')).toBe(strings.activity.bellNone)
    state.route.set({ name: 'activity' })
    expect(link().getAttribute('aria-current')).toBe('page')
    const click = fakeEvent('click') as unknown as Event
    link().dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(isPopoverOpen(panel as never)).toBe(false)
  })

  it('marks apart, and never counts, that the person’s agent cannot answer', () => {
    const { state, bell, link } = shown()
    state.conversations.set([])
    expect(bell.querySelector('.agent-mark')).toBeNull()
    state.directory.set([
      entry(ANA, 'Ana', {
        presence: { humanOnline: true, agentOnline: true, agentUnavailable: { until: null, kind: 'failed' } },
      }),
    ])
    expect(bell.querySelector('.agent-mark')).not.toBeNull()
    expect(bell.querySelector('.activity-count')).toBeNull()
    expect(link().getAttribute('aria-label')).toBe(strings.activity.bellNoneAgentUnavailable)
  })

  it('leads to the activity page in a browser without popovers', () => {
    installFakeDom({ popovers: false })
    const { link } = shown()
    const click = fakeEvent('click') as unknown as Event
    link().dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
  })
})

describe('activityPanel', () => {
  it('draws its items only while open, loads what it lists, and loads drafts that arrive meanwhile', () => {
    const { state, panel, called } = shown()
    state.threads.set(new Map([[ROOM, { notes: [draft('note_d1')], hasMore: false }]]))
    expect(panel.querySelector('.activity-item')).toBeNull()
    expect(called('loadActivity')).toHaveLength(1)
    panel.showPopover()
    expect(called('loadActivity')).toHaveLength(2)
    expect(getByRole(panel, 'heading', { name: strings.activity.title })).toBeTruthy()
    expect(textOf(panel)).toContain(strings.activity.groups.drafts)
    state.conversations.update((all) => [...all])
    expect(called('loadDraftThreads')).toHaveLength(1)
    panel.hidePopover()
    expect(panel.querySelector('.activity-item')).toBeNull()
    state.conversations.update((all) => [...all])
    expect(called('loadDraftThreads')).toHaveLength(1)
  })

  it('sends, edits and discards a draft through the same actions as its conversation', () => {
    const { state, panel, dialog, called } = shown()
    const one = draft('note_d1')
    state.threads.set(new Map([[ROOM, { notes: [one], hasMore: false }]]))
    panel.showPopover()
    const card = panel.querySelector('[data-draft-id="note_d1"]')!
    expect(textOf(card)).toContain(one.body)
    getByRole(card, 'button', { name: strings.send }).click()
    expect(called('approveDraft')[0]!.args).toEqual([one, null, []])
    expect(called('approveDraft')[0]!.then!.attempt).toBe('draft')
    getByRole(card, 'button', { name: strings.edit }).click()
    expect(dialog.open).toBe(true)
    getByRole(card, 'button', { name: strings.discard }).click()
    expect(called('discardDraft')[0]!.args).toEqual([one])
    expect(
      getByRole(panel, 'link', { name: strings.activity.withPeople({ names: 'Ben' }) }).getAttribute('href'),
    ).toBe(`#/c/${ROOM}?draft=note_d1`)
  })

  it('asks to read a changed draft again before it can be sent', () => {
    const { state, panel, called } = shown()
    const changed = draft('note_d1', { body: 'Send me the payroll file.' })
    state.draftsRead.set(new Map([[changed.id, { body: 'Lunch?', conversationId: ROOM }]]))
    state.threads.set(new Map([[ROOM, { notes: [changed], hasMore: false }]]))
    panel.showPopover()
    expect(queryByRole(panel, 'button', { name: strings.send })).toBeNull()
    getByRole(panel, 'button', { name: strings.draftReadAgain }).click()
    expect(called('confirmDraftRead')[0]!.args).toEqual([changed])
  })

  it('sends or discards an answer to review, and redraws only what changed', () => {
    const { state, panel, called } = shown()
    state.threads.set(new Map([[ROOM, { notes: [draft('note_d1')], hasMore: false }]]))
    state.reviews.set([review()])
    panel.showPopover()
    const card = panel.querySelector('.review-card')!
    const draftCard = panel.querySelector('.pending')!
    getByRole(card, 'button', { name: strings.channelAgent.send }).click()
    expect(called('sendReview')[0]!.args).toEqual([review(), null])
    getByRole(card, 'button', { name: strings.channelAgent.discard }).click()
    expect(called('discardReview')[0]!.args).toEqual([review()])
    state.reviews.set([])
    expect(panel.querySelector('.review-card')).toBeNull()
    expect(panel.querySelector('.pending')).toBe(draftCard)
    state.threads.set(new Map([[ROOM, { notes: [], hasMore: false }]]))
    state.conversations.set([])
    expect(textOf(panel)).toContain(strings.activity.empty)
  })

  it('shows a skipped note, the desk that cannot answer and a room, each with its way on', () => {
    const { state, panel } = shown()
    const asked = note('note_asked', { authorId: BEN, body: 'Does it clash?' })
    state.conversations.set([conversation()])
    state.threads.set(new Map([[ROOM, { notes: [asked], hasMore: false }]]))
    state.releases.set(new Map([[asked.id, { reason: 'No calendar.', agentName: null }]]))
    state.directory.set([
      entry(ANA, 'Ana', {
        presence: { humanOnline: true, agentOnline: true, agentUnavailable: { until: null, kind: 'failed' } },
      }),
      entry(BEN, 'Ben'),
    ])
    state.debates.set([summary({ participantIds: [BEN] })])
    panel.showPopover()
    expect(textOf(panel)).toContain(strings.agentReleased({ reason: 'No calendar.' }))
    expect(getByRole(panel, 'link', { name: strings.activity.replyYourself }).getAttribute('href')).toBe(
      `#/c/${ROOM}`,
    )
    expect(textOf(panel)).toContain(strings.deskUnavailableReason.failed)
    expect(getByRole(panel, 'link', { name: strings.activity.openConnection }).getAttribute('href')).toBe(
      '#/agent/connection',
    )
    expect(textOf(panel)).toContain(strings.activity.debateAsks)
    getByRole(panel, 'link', { name: strings.activity.openRoom }).click()
    expect(isPopoverOpen(panel as never)).toBe(false)
  })

  it('closes when the page moves on, and when its life ends', () => {
    const { state, panel, life } = shown()
    panel.showPopover()
    state.route.set({ name: 'people' })
    expect(isPopoverOpen(panel as never)).toBe(false)
    panel.showPopover()
    life.end()
    expect(panel.querySelector('.activity')).toBeNull()
    expect(panel.id).toBe(ACTIVITY_PANEL_ID)
  })

  it('shows a loading line for a conversation whose drafts are on their way', () => {
    const { panel } = shown()
    panel.showPopover()
    expect(textOf(panel)).toContain(strings.activity.draftsLoading({ count: 1 }))
  })
})

describe('activityView', () => {
  it('is the same list as a page, loaded as it opens', () => {
    const { context, called } = testContext()
    context.state.session.set(me())
    context.state.threads.set(
      new Map([[ROOM as ConversationId, { notes: [draft('note_d1')], hasMore: false }]]),
    )
    context.state.conversations.set([conversation()])
    const page = mount(activityView(context, lifetime(), me()))
    expect(called('loadActivity')).toHaveLength(1)
    expect(getByRole(page, 'heading', { name: strings.activity.title })).toBeTruthy()
    expect(page.querySelector('[data-draft-id="note_d1"]')).not.toBeNull()
  })
})
