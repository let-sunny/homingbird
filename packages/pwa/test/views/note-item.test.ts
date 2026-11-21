import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { noteItemModel } from '../../src/models/note-item.ts'
import { strings } from '../../src/strings.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { renderNoteItem } from '../../src/views/note-item.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, ROOM, channel, conversation, note } from '../support/fixtures.ts'
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
  it('copies the note’s text from its menu, and says whether the browser let it', async () => {
    const { context, page } = testContext()
    const shown = render(context, note('n1', { authorId: ANA }))
    expect(shown.querySelector('.note-reply')).toBeNull()
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
    expect(called('chooseReplyTarget')[0]!.args).toEqual([ROOM, 'n1'])
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

  it('asks the agent anyway after it let a note go', () => {
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
})
