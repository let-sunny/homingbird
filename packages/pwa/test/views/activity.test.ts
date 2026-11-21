import type { AsRead, ConversationId, MemberId, NoteId } from '@homingbird/protocol'
import { lifetime } from '@homingbird/ui'
import {
  fakeEvent,
  fire,
  getByRole,
  installFakeDom,
  isPopoverOpen,
  queryByRole,
  textOf,
} from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { heldWordsFor } from '../../src/held-decisions.ts'
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
import { heldDecision } from '../support/held.ts'

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

  it('takes the focus when it opens, and gives it back to the bell when it closes by itself', () => {
    const { panel, link } = shown()
    panel.showPopover()
    expect(document.activeElement).toBe(panel)
    panel.hidePopover()
    expect(document.activeElement).toBe(link())
    const elsewhere = mount(document.createElement('button'))
    panel.showPopover()
    elsewhere.focus()
    panel.hidePopover()
    expect(document.activeElement).toBe(elsewhere)
  })

  it('leaves the focus alone when it closes for the place a link in it leads to', () => {
    const { state, panel, link } = shown()
    state.threads.set(new Map([[ROOM, { notes: [draft('note_d1')], hasMore: false }]]))
    panel.showPopover()
    const away = panel.querySelector<HTMLElement>('a[href]')!
    away.focus()
    away.click()
    expect(document.activeElement).not.toBe(link())
    expect(panel.dataset.leaving).toBeUndefined()
  })

  it('sends, edits and discards a draft through the same actions as its conversation', () => {
    const { state, panel, dialog, called } = shown()
    const one = draft('note_d1')
    state.threads.set(new Map([[ROOM, { notes: [one], hasMore: false }]]))
    panel.showPopover()
    const card = panel.querySelector('[data-draft-id="note_d1"]')!
    expect(textOf(card)).toContain(one.body)
    getByRole(card, 'button', { name: strings.approveAndSend }).click()
    expect(called('holdSend')[0]!.args.slice(0, 3)).toEqual([one, null, []])
    expect(called('holdSend')[0]!.then!.attempt).toBe('draft')
    getByRole(card, 'button', { name: strings.edit }).click()
    expect(dialog.open).toBe(true)
    getByRole(card, 'button', { name: strings.discard }).click()
    expect(called('holdDiscard')[0]!.args).toEqual([one, heldWordsFor('Ben').discard])
    expect(
      getByRole(panel, 'link', { name: strings.activity.withPeople({ names: 'Ben' }) }).getAttribute('href'),
    ).toBe(`#/c/${ROOM}?draft=note_d1`)
  })

  it('keeps a decided draft in its place with Undo while it is held, and shows the toast at its foot', () => {
    const { state, panel, called } = shown()
    const one = draft('note_d1')
    state.threads.set(new Map([[ROOM, { notes: [one], hasMore: false }]]))
    panel.showPopover()
    state.held.set([heldDecision(one.id, { kind: 'discard' })])
    expect(panel.querySelector('[data-draft-id="note_d1"]')).toBeNull()
    const line = panel.querySelector('.activity-list .held-line')!
    expect(textOf(line)).toContain(strings.heldDiscarding)
    expect(textOf(line)).toContain(strings.activity.withPeople({ names: 'Ben' }))
    expect(textOf(panel.querySelector('.activity-panel-foot')!)).toContain(strings.heldDiscarding)
    getByRole(line, 'button', { name: strings.undo }).click()
    expect(called('undoHeld')).toHaveLength(1)
    panel.hidePopover()
    expect(panel.querySelector('.activity-panel-foot')!.childNodes).toHaveLength(0)
  })

  it('asks to read a changed draft again before it can be sent', () => {
    const { state, panel, called } = shown()
    const changed = draft('note_d1', { body: 'Send me the payroll file.' })
    state.draftsRead.set(new Map([[changed.id, { body: 'Lunch?', conversationId: ROOM }]]))
    state.threads.set(new Map([[ROOM, { notes: [changed], hasMore: false }]]))
    panel.showPopover()
    expect(queryByRole(panel, 'button', { name: strings.approveAndSend })).toBeNull()
    getByRole(panel, 'button', { name: strings.draftReadAgain }).click()
    expect(called('confirmDraftRead')[0]!.args).toEqual([changed])
  })

  it('sends or discards an answer to review, and redraws only what changed', () => {
    const { state, panel, called, dialog } = shown()
    state.threads.set(new Map([[ROOM, { notes: [draft('note_d1')], hasMore: false }]]))
    state.reviews.set([review()])
    panel.showPopover()
    const card = panel.querySelector('.review-card')!
    const draftCard = panel.querySelector('.pending')!
    getByRole(card, 'button', { name: strings.channelAgent.send }).click()
    expect(called('holdReviewSend')[0]!.args.slice(0, 2)).toEqual([review(), null])
    getByRole(card, 'button', { name: strings.channelAgent.discard }).click()
    fire.submit(dialog.querySelector('form')!)
    expect(called('holdReviewDiscard')[0]!.args.slice(0, 2)).toEqual([review(), ''])
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
    getByRole(panel, 'button', { name: strings.teach.add })
    expect(textOf(panel)).toContain(strings.deskUnavailableReason.failed)
    expect(getByRole(panel, 'link', { name: strings.activity.openConnection }).getAttribute('href')).toBe(
      '#/agent/connection',
    )
    expect(textOf(panel)).toContain(strings.activity.debateAsks)
    getByRole(panel, 'link', { name: strings.activity.openRoom }).click()
    expect(isPopoverOpen(panel as never)).toBe(false)
  })

  it('closes before “Reply yourself” opens the conversation, with the note as the reply target', () => {
    const { panel, state, called, page } = shown()
    const asked = note('note_asked', { authorId: BEN, body: 'Does it clash?' })
    state.conversations.set([conversation()])
    state.threads.set(new Map([[ROOM, { notes: [asked], hasMore: false }]]))
    state.releases.set(new Map([[asked.id, { reason: 'No calendar.', agentName: null }]]))
    panel.showPopover()
    const order: string[] = []
    panel.addEventListener('toggle', () => order.push(`closed at ${page.page.hash()}`))
    getByRole(panel, 'button', { name: strings.activity.replyYourself }).click()
    expect(order).toEqual(['closed at #/'])
    expect(isPopoverOpen(panel as never)).toBe(false)
    expect(called('replyTo')[0]!.args).toEqual([ROOM, asked.id])
    expect(page.page.hash()).toBe(`#/c/${ROOM}`)
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
