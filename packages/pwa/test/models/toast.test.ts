import { describe, expect, it } from 'vitest'
import { heldWordsFor } from '../../src/held-decisions.ts'
import { heldToastModel, toastModel } from '../../src/models/toast.ts'
import { strings } from '../../src/strings.ts'

describe('toastModel', () => {
  it('shows nothing without a notice', () => {
    expect(toastModel(null)).toBeNull()
  })

  it('reads an error out at once, and an information as a status, with its link', () => {
    expect(toastModel({ kind: 'error', text: 'No.' })).toEqual({
      className: 'toast is-error',
      role: 'alert',
      text: 'No.',
      link: null,
      close: strings.close,
    })
    expect(
      toastModel({ kind: 'info', text: 'Moved.', link: { href: '#/c/x', label: 'Open' } }),
    ).toMatchObject({
      role: 'status',
      link: { href: '#/c/x', label: 'Open' },
    })
  })
})

describe('heldToastModel', () => {
  const held = (phase: 'waiting' | 'committing' | 'done') => ({
    noteId: 'd1' as never,
    kind: 'send' as const,
    phase,
    words: heldWordsFor('Ben').send,
  })

  it('counts down to when the latest send goes, with Undo and Send now, then that it is on its way until the server has it, then that it was sent', () => {
    expect(heldToastModel([])).toBeNull()
    expect(heldToastModel([held('done'), held('waiting')])).toEqual({
      className: 'toast is-held is-waiting',
      text: strings.heldSendingIn({ names: 'Ben', seconds: 5 }),
      undo: strings.undo,
      dismiss: { label: strings.heldSendNow, does: 'commit' },
    })
    expect(heldToastModel([held('waiting')], 2)!.text).toBe(
      strings.heldSendingIn({ names: 'Ben', seconds: 2 }),
    )
    expect(
      heldToastModel([{ ...held('waiting'), kind: 'discard', words: heldWordsFor('Ben').discard }], 9),
    ).toMatchObject({
      text: strings.heldDiscardingIn({ seconds: 5 }),
      dismiss: { label: strings.heldDiscardNow, does: 'commit' },
    })
    expect(heldToastModel([held('committing')])).toEqual({
      className: 'toast is-held is-committing',
      text: strings.heldSending({ names: 'Ben' }),
      undo: null,
      dismiss: null,
    })
    expect(heldToastModel([held('done')])).toEqual({
      className: 'toast is-held is-done',
      text: strings.heldSent({ names: 'Ben' }),
      undo: null,
      dismiss: { label: strings.close, does: 'forget' },
    })
  })
})
