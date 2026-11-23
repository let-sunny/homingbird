import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { noteItemModel } from '../../src/models/note-item.ts'
import { strings } from '../../src/strings.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { renderNoteItem } from '../../src/views/note-item.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, ROOM, channel, conversation, note, serverInfo } from '../support/fixtures.ts'
import { threadInput } from '../support/thread.ts'

usingFakeDom()

const item = (shown: ReturnType<typeof note>) => ({
  type: 'note' as const,
  key: shown.id,
  note: shown,
  leadsRun: true,
  next: null,
})

const render = (
  context: ReturnType<typeof testContext>['context'],
  shown: ReturnType<typeof note>,
  input = threadInput(),
) => {
  const list =
    document.querySelector('ol.notes') ??
    mount(Object.assign(document.createElement('ol'), { className: 'notes' }))
  const element = renderNoteItem(context, lifetime(), noteItemModel(input, item(shown)), shown, ROOM)
  list.append(element)
  return element
}

describe('renderNoteItem', () => {
  it('links the quote of the note it answers to that note', () => {
    const { context } = testContext()
    const question = note('q', { body: 'When do we ship?', authorId: ANA })
    const answer = note('a', { inReplyTo: 'q' as never })
    const shown = render(
      context,
      answer,
      threadInput({ thread: { notes: [question, answer], hasMore: false } }),
    )
    const quote = getByRole(shown, 'link', { name: /When do we ship\?/ })
    expect(quote.getAttribute('href')).toBe(`#/c/${ROOM}?note=q`)
    expect(textOf(quote)).toContain(strings.quotedNote)
  })

  it('shows the start of a long note and opens the rest in place, kept open when drawn again', () => {
    const { context } = testContext()
    const long = note('n1', { body: 'word '.repeat(400) })
    const shown = render(context, long)
    const body = shown.querySelector('.note-body')!
    const more = getByRole(shown, 'button', { name: strings.showMoreNote })
    expect([body.classList.contains('is-collapsed'), more.getAttribute('aria-expanded')]).toEqual([
      true,
      'false',
    ])
    expect(more.getAttribute('aria-controls')).toBe(body.id)
    more.click()
    expect([body.classList.contains('is-collapsed'), more.getAttribute('aria-expanded')]).toEqual([
      false,
      'true',
    ])
    expect(textOf(more)).toBe(strings.showLessNote)
    const again = render(context, long)
    expect(again.querySelector('.note-body')!.classList.contains('is-collapsed')).toBe(false)
    getByRole(again, 'button', { name: strings.showLessNote }).click()
    expect(again.querySelector('.note-body')!.classList.contains('is-collapsed')).toBe(true)
    expect(render(context, note('n2')).querySelector('.note-more-text')).toBeNull()
  })

  it('keeps Show less where it was on screen when the note folds above it', () => {
    const { context } = testContext()
    const scroller = mount(Object.assign(document.createElement('div'), { className: 'thread-scroll' }))
    const list = Object.assign(document.createElement('ol'), { className: 'notes' })
    scroller.append(list)
    const shown = render(context, note('n1', { body: 'word '.repeat(400) }))
    Object.assign(scroller, { scrollHeight: 3000, clientHeight: 700, scrollTop: 900 })
    const toggle = shown.querySelector<HTMLElement>('.note-more-text')!
    const body = shown.querySelector('.note-body')!
    const placeOnScreen = () => ({ top: body.classList.contains('is-collapsed') ? 120 : 520 })
    Object.assign(toggle, { getBoundingClientRect: placeOnScreen })
    toggle.click()
    expect(scroller.scrollTop).toBe(900)
    toggle.click()
    expect([body.classList.contains('is-collapsed'), scroller.scrollTop]).toEqual([true, 500])
  })

  it('copies the note’s text from its menu, and says whether the browser let it', async () => {
    const { context, page } = testContext()
    const shown = render(context, note('n1', { authorId: ANA }))
    getByRole(shown, 'button', { name: strings.noteMore }).click()
    getByRole(shown, 'menuitem', { name: strings.copyNote }).click()
    await Promise.resolve()
    expect(page.copied).toEqual(['body of n1'])
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.noteCopied })
    page.state.clipboard = false
    getByRole(shown, 'button', { name: strings.noteMore }).click()
    getByRole(shown, 'menuitem', { name: strings.copyNote }).click()
    await Promise.resolve()
    expect(context.state.notice.get()).toEqual({ kind: 'error', text: strings.noteNotCopied })
    page.state.clipboard = true
    getByRole(shown, 'button', { name: strings.noteMore }).click()
    getByRole(shown, 'menuitem', { name: strings.copyNoteLink }).click()
    await Promise.resolve()
    expect(page.copied.at(-1)).toBe(`http://localhost/#/c/${ROOM}?note=n1`)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.noteLinkCopied })
  })

  it('says in the menu of the person’s own note that a sent note stays as it is, and only there', () => {
    const { context } = testContext()
    const mine = render(context, note('n1', { authorId: ANA }))
    expect(textOf(mine.querySelector('.note-menu'))).toContain(strings.noteFixed)
    expect(mine.querySelector('.note-fixed')?.getAttribute('role')).toBeNull()
    const theirs = render(context, note('n2'))
    expect(textOf(theirs.querySelector('.note-menu'))).not.toContain(strings.noteFixed)
  })

  it('shows Ask my agent disabled with the reason where the server takes no draft requests', () => {
    const { context, called } = testContext()
    const shown = render(context, note('n1'), threadInput({ serverInfo: serverInfo() }))
    getByRole(shown, 'button', { name: strings.noteMore }).click()
    const ask = getByRole(shown, 'menuitem', { name: strings.askAgentToReply }) as HTMLButtonElement
    expect(ask.disabled).toBe(true)
    expect(textOf(shown.querySelector(`#${ask.getAttribute('aria-describedby')}`)!)).toBe(strings.askAgentOff)
    ask.click()
    expect(called('askAgent')).toHaveLength(0)
  })

  it('opens the same menu on a right-click on the note, and gives the focus back to the note', () => {
    const { context } = testContext()
    const shown = render(context, note('n1'))
    expect(fire.event(shown.querySelector('.bubble'), 'contextmenu', { clientX: 5, clientY: 5 })).toBe(false)
    const menu = shown.querySelector('.note-menu')!
    expect(menu.matches(':popover-open')).toBe(true)
    fire.key(document.activeElement, 'Escape')
    expect(document.activeElement).toBe(shown)
    expect(shown.classList.contains('is-active')).toBe(false)
  })

  it('replies, asks the agent to draft a reply, and marks the note looked at on a click', () => {
    const { context, called } = testContext()
    const shown = render(context, note('n1', { sentAt: 5, basis: 'Read it.' }))
    const toolbar = shown.querySelector('.note-toolbar')!
    getByRole(toolbar, 'button', { name: strings.reply }).click()
    getByRole(toolbar, 'button', { name: strings.noteMore }).click()
    getByRole(shown, 'menuitem', { name: strings.askAgentToReply }).click()
    getByRole(toolbar, 'button', { name: strings.noteMore }).click()
    getByRole(shown, 'menuitem', { name: strings.reply }).click()
    expect(called('replyTo').map((call) => call.args)).toEqual([
      [ROOM, 'n1'],
      [ROOM, 'n1'],
    ])
    expect(called('askAgent')[0]!.args).toEqual([
      { destination: { inReplyTo: 'n1' }, instruction: '', agentId: null },
    ])
    shown.querySelector<HTMLElement>('.bubble')!.click()
    expect(shown.classList.contains('is-active')).toBe(true)
    const other = render(context, note('n2'))
    other.querySelector<HTMLElement>('.bubble')!.click()
    expect(shown.classList.contains('is-active')).toBe(false)
    other.querySelector<HTMLElement>('.bubble')!.click()
    expect(other.classList.contains('is-active')).toBe(false)
    const again = render(context, note('n2'))
    expect(again.classList.contains('is-active')).toBe(false)
  })

  it('shows the person’s own note with its basis and state, and keeps it looked at when redrawn', () => {
    const { context } = testContext()
    const mine = note('n1', {
      authorId: ANA,
      basis: 'Read the runbook.',
      receipts: [
        { memberId: BEN, state: 'read', deliveredAt: 1, readAt: 2, draftingAt: null, repliedAt: null },
      ],
    })
    const shown = render(context, mine)
    const basis = shown.querySelector('.note-basis')!
    expect(textOf(basis)).toContain('Read the runbook.')
    expect(basis.classList.contains('is-mine')).toBe(true)
    const column = shown.querySelector('.note-column')!
    expect([...column.children].map((child) => child.getAttribute('class'))).toEqual([
      'visually-hidden',
      'bubble-row',
      'note-basis is-mine',
      'note-meta',
    ])
    expect(getByRole(shown, 'img', { name: strings.status.read })).toBeTruthy()
    shown.classList.add('is-active')
    expect(render(context, mine).classList.contains('is-active')).toBe(true)
  })

  it('says a saved answer sent the note, and recalls it on its author’s click', () => {
    const { context, called } = testContext()
    const mine = note('n1', { authorId: ANA, autoSent: true, origin: 'agent', agentName: 'Desk', sentAt: 10 })
    const shown = render(context, mine)
    expect(shown.querySelector('.note-auto-sent')!.textContent).toContain(strings.autoSend.sentByYours)
    getByRole(shown, 'button', { name: strings.autoSend.recall }).click()
    const [recall] = called('recallNote')
    expect(recall!.args).toEqual([mine])
    recall!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.autoSend.recalled })
    const theirs = render(context, note('n2', { autoSent: true }))
    expect(theirs.querySelector('.recall-note')).toBeNull()
  })

  it('asks the agent anyway after it let a note go, or opens teaching it with a title filled in', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    const question = note('q')
    const shown = render(
      context,
      question,
      threadInput({
        conversations: [conversation({ kind: 'channel' })],
        thread: { notes: [question], hasMore: false },
        releases: new Map([[question.id, { reason: null, agentName: null }]]),
      }),
    )
    getByRole(shown, 'button', { name: strings.askAnyway }).click()
    expect(called('askAgent')).toHaveLength(1)
    getByRole(shown, 'button', { name: strings.teach.add }).click()
    const topic = document.querySelector<HTMLInputElement>('dialog input[name="topic"]')
    expect(topic?.value).toBe('body of q')
  })

  it('names the author of a note in a room as a button that opens their profile card', () => {
    const { context } = testContext()
    const question = note('q', { authorId: BEN })
    const shown = render(
      context,
      question,
      threadInput({
        conversations: [conversation({ kind: 'channel' })],
        thread: { notes: [question], hasMore: false },
      }),
    )
    const name = shown.querySelector<HTMLElement>('.note-author .profile-name')!
    expect(name.textContent).toBe('Ben')
    expect(name.dataset.profile).toBe(BEN)
    expect(shown.querySelector<HTMLElement>('.author-button')!.dataset.profile).toBe(BEN)
  })

  it('offers a manager who discarded the agent’s answer to reply to the question themself', () => {
    const { context, called } = testContext()
    const question = note('q', { authorId: BEN })
    const shown = render(
      context,
      question,
      threadInput({
        conversations: [conversation({ kind: 'channel' })],
        thread: { notes: [question], hasMore: false },
        discardedAnswers: new Map([[question.id, 'Billing helper']]),
      }),
    )
    expect(textOf(shown)).toContain(strings.channelAgent.answerDiscarded({ agent: 'Billing helper' }))
    getByRole(shown, 'button', { name: strings.activity.replyYourself }).click()
    expect(called('replyTo')[0]!.args).toEqual([ROOM, question.id])
  })

  it('names who answered a question', () => {
    const { context } = testContext()
    const answered = note('q', {
      receipts: [
        { memberId: BEN, state: 'replied', deliveredAt: 1, readAt: 2, draftingAt: null, repliedAt: 3 },
      ],
    })
    const shown = render(
      context,
      answered,
      threadInput({ conversations: [conversation({ kind: 'channel' })] }),
    )
    expect(textOf(shown)).toContain(strings.answeredBy({ names: 'Ben' }))
  })

  it('says under the person’s waiting question who answers, as a warning when nobody can now', () => {
    const { context } = testContext()
    const asked = note('q', { authorId: ANA })
    const shown = render(
      context,
      asked,
      threadInput({
        conversations: [conversation({ kind: 'channel' })],
        channels: [channel('billing', { conversationId: ROOM, helperCount: 0 })],
        thread: { notes: [asked], hasMore: false },
      }),
    )
    const line = getByRole(shown, 'status')
    expect(textOf(line)).toBe(strings.channelAnswer.nobodyAnswers)
    expect(line.className).toContain('is-warning')
  })

  it('shows a posted debate result as its conclusion and next steps, the whole note folded, and a link to its room', () => {
    const { context } = testContext()
    const fromDebate = { debateId: 'deb_room00000000' as never, question: 'Ship?', agents: [] }
    const body = [
      'From the flock: Ship?',
      'Result: conclusion',
      'Ship Friday.',
      'Reasons\n\n- Tests pass.',
      'Next steps\n\n- Tag it',
      'Contributions\n\n- Ana’s agent: Checked.',
    ].join('\n\n')
    const shown = render(context, note('r1', { authorId: BEN, origin: 'agent', body, fromDebate }))
    const bubble = shown.querySelector('.bubble')!
    expect(textOf(bubble.querySelector('.debate-note-heading')!)).toBe(strings.debateNote.agreed)
    expect(textOf(bubble.querySelector('.debate-note-steps')!)).toBe('Tag it')
    expect(textOf(bubble.querySelector('.debate-note-whole summary')!)).toBe(strings.debateNote.whole)
    expect(bubble.querySelector('.debate-note-room')!.getAttribute('href')).toBe(
      '#/debate/deb_room00000000/result',
    )
    const unshaped = render(
      context,
      note('r2', { authorId: BEN, origin: 'agent', body: 'By hand.', fromDebate }),
    )
    expect(textOf(unshaped.querySelector('.note-body')!)).toBe('By hand.')
    expect(unshaped.querySelector('.debate-note-whole')).toBeNull()
    expect(unshaped.querySelector('.debate-note-room')).not.toBeNull()
  })
})
