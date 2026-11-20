import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { draftsItemModel } from '../../src/models/drafts-item.ts'
import { strings } from '../../src/strings.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { renderDraftsItem } from '../../src/views/drafts-item.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ROOM, channel, conversation, draft, principle, taught } from '../support/fixtures.ts'
import { threadInput } from '../support/thread.ts'

usingFakeDom()

const item = (drafts: ReturnType<typeof draft>[]) => ({
  type: 'drafts' as const,
  key: 'drafts',
  inReplyTo: null,
  drafts,
})

describe('renderDraftsItem', () => {
  it('sends, edits, saves and discards a draft, discarding the alternatives of the one sent', () => {
    const { context, called } = testContext()
    const dialog = mount(dialogHost())
    const [a, b] = [draft('d1'), draft('d2')]
    const shown = mount(renderDraftsItem(context, draftsItemModel(threadInput(), item([a, b]))))
    const card = shown.querySelector('[data-draft-id="d1"]')!
    getByRole(card, 'button', { name: strings.send }).click()
    expect(called('approveDraft')[0]!.args).toEqual([a, null, [b]])
    expect(called('approveDraft')[0]!.then!.attempt).toBe('draft')
    getByRole(card, 'button', { name: strings.edit }).click()
    fire.type(getByRole(dialog, 'textbox', { name: strings.editDraftLabel }), 'Edited')
    getByRole(dialog, 'button', { name: strings.saveDraft }).click()
    expect(called('saveDraft')[0]!.args).toEqual([a, 'Edited'])
    fire.submit(dialog.querySelector('form')!)
    expect(called('approveDraft')[1]!.args).toEqual([a, 'Edited', [b]])
    called('approveDraft')[1]!.then!.done!(undefined)
    expect(dialog.open).toBe(false)
    getByRole(card, 'button', { name: strings.edit }).click()
    fire.submit(dialog.querySelector('form')!)
    called('approveDraft')[2]!.then!.failed!({ _tag: 'Unavailable', message: 'down' })
    expect(dialog.open).toBe(true)
    called('approveDraft')[2]!.then!.failed!({
      _tag: 'Conflict',
      message: 'This draft changed; read it again.',
    })
    expect(dialog.open).toBe(false)
    getByRole(card, 'button', { name: strings.discard }).click()
    expect(called('discardDraft')[0]!.args).toEqual([a])
  })

  it('shows its basis, what it applied, a missing basis, and sends a channel question elsewhere', () => {
    const { context } = testContext()
    const dialog = mount(dialogHost())
    const billing = channel('billing', { conversationId: ROOM })
    const input = threadInput({
      conversations: [conversation({ kind: 'channel', title: 'billing' })],
      channels: [billing],
      taught: taught({ principles: [principle('Tone')] }),
    })
    const shown = mount(
      renderDraftsItem(
        context,
        draftsItemModel(
          input,
          item([draft('d1', { basis: 'Read it.\nPrinciples applied: Tone' }), draft('d2', { basis: null })]),
        ),
      ),
    )
    expect(textOf(shown.querySelector('[data-draft-id="d1"] .draft-basis')!)).not.toContain(
      'Principles applied',
    )
    expect(textOf(shown)).toContain(strings.teach.applied({ title: 'Tone' }))
    expect(textOf(shown)).toContain(strings.draftBasisMissing)
    expect(textOf(shown)).toContain(strings.sendsToChannel({ channel: '#billing' }))
    getByRole(shown.querySelector('[data-draft-id="d1"]')!, 'button', { name: strings.changeChannel }).click()
    expect(dialog.open).toBe(true)
  })

  it('reports each draft seen once, waiting while the page is hidden', () => {
    const { context, called, page } = testContext()
    const one = draft('d1')
    page.state.visible = false
    mount(renderDraftsItem(context, draftsItemModel(threadInput(), item([one]))))
    page.runFrames()
    expect(called('reportDraftSeen')).toHaveLength(0)
    page.state.visible = true
    page.emit('visibilitychange')
    page.emit('visibilitychange')
    expect(called('reportDraftSeen').map((call) => call.args)).toEqual([['d1']])
    mount(renderDraftsItem(context, draftsItemModel(threadInput(), item([one]))))
    page.runFrames()
    renderDraftsItem(context, draftsItemModel(threadInput(), item([draft('d3')])))
    page.runFrames()
    expect(called('reportDraftSeen')).toHaveLength(1)
  })

  it('offers nothing to decide in an archived room', () => {
    const { context } = testContext()
    const shown = renderDraftsItem(
      context,
      draftsItemModel(threadInput({ conversations: [conversation({ archivedAt: 5 })] }), item([draft('d1')])),
    )
    expect(shown.querySelector('.draft-actions')).toBeNull()
    expect(textOf(shown)).toContain(strings.archivedRoomNotice)
  })
})
