import { lifetime } from '@homingbird/ui'
import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { noteItemModel } from '../../src/models/note-item.ts'
import { strings } from '../../src/strings.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { renderNoteItem } from '../../src/views/note-item.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, ROOM, conversation, note } from '../support/fixtures.ts'
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
  it('replies, asks the agent to draft a reply, and marks the note looked at on a click', () => {
    const { context, called } = testContext()
    const shown = render(context, note('n1', { sentAt: 5, basis: 'Read it.' }))
    getByRole(shown, 'button', { name: strings.reply }).click()
    getByRole(shown, 'button', { name: strings.askAgentToReply }).click()
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
    expect(textOf(shown.querySelector('.note-basis')!)).toContain('Read the runbook.')
    expect(getByRole(shown, 'img', { name: strings.status.read })).toBeTruthy()
    shown.classList.add('is-active')
    expect(render(context, mine).classList.contains('is-active')).toBe(true)
  })

  it('asks the agent anyway after it let a note go, and moves an open channel question', () => {
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
    getByRole(shown, 'button', { name: strings.moveToChannel }).click()
    expect((document.getElementById('dialog') as HTMLDialogElement).open).toBe(true)
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
})
