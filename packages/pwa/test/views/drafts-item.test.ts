import { DRAFT_CHANGED } from '@homingbird/protocol'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { channelLabel } from '../../src/channels.ts'
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
    called('approveDraft')[2]!.then!.failed!({ _tag: 'Conflict', message: 'This draft was already sent.' })
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

describe('a draft its agent changed after the person read it', () => {
  it('offers no Send or Edit until the person has read it again, and lets them discard it', () => {
    const { context, called } = testContext()
    const read = new Map([['d1' as never, { body: 'what Ana read', conversationId: ROOM }]])
    const changed = draft('d1', { body: 'rewritten by the agent' })
    const shown = mount(
      renderDraftsItem(context, draftsItemModel(threadInput({ draftsRead: read }), item([changed]))),
    )
    expect(textOf(getByRole(shown, 'alert'))).toBe(strings.draftChangedSinceRead)
    expect(textOf(shown)).toContain('rewritten by the agent')
    expect(queryByRole(shown, 'button', { name: strings.send })).toBeNull()
    expect(queryByRole(shown, 'button', { name: strings.edit })).toBeNull()
    getByRole(shown, 'button', { name: strings.draftReadAgain }).click()
    expect(called('confirmDraftRead')[0]!.args).toEqual([changed])
    getByRole(shown, 'button', { name: strings.discard }).click()
    expect(called('discardDraft')[0]!.args).toEqual([changed])
  })

  it('keeps the person’s edit when the send is refused, shows the draft as it is now, and sends from that', () => {
    const { context, called } = testContext()
    const dialog = mount(dialogHost())
    const read = draft('d1')
    const shown = mount(renderDraftsItem(context, draftsItemModel(threadInput(), item([read]))))
    getByRole(shown, 'button', { name: strings.edit }).click()
    const text = getByRole(dialog, 'textbox', { name: strings.editDraftLabel }) as HTMLTextAreaElement
    fire.type(text, 'Ana’s edit')
    fire.submit(dialog.querySelector('form')!)
    const now = draft('d1', { body: 'rewritten by the agent' })
    context.state.threads.set(new Map([[ROOM, { notes: [now], hasMore: false }]]))
    called('approveDraft')[0]!.then!.failed!({ _tag: 'Conflict', message: DRAFT_CHANGED })
    expect(dialog.open).toBe(true)
    expect(text.value).toBe('Ana’s edit')
    expect(textOf(getByRole(dialog, 'alert'))).toBe(
      `${strings.draftChangedWhileEditing}rewritten by the agent`,
    )
    fire.submit(dialog.querySelector('form')!)
    expect(called('approveDraft')[1]!.args).toEqual([now, 'Ana’s edit', []])
    getByRole(dialog, 'button', { name: strings.saveDraft }).click()
    expect(called('saveDraft')[0]!.args).toEqual([now, 'Ana’s edit'])
  })

  it('holds Send and Save when the draft moved to another room, until the person confirms where it goes', () => {
    const { context, called } = testContext()
    const dialog = mount(dialogHost())
    const all = channel('all-company')
    const shown = mount(renderDraftsItem(context, draftsItemModel(threadInput(), item([draft('d1')]))))
    getByRole(shown, 'button', { name: strings.edit }).click()
    const text = getByRole(dialog, 'textbox', { name: strings.editDraftLabel }) as HTMLTextAreaElement
    fire.type(text, 'Ana’s edit')
    fire.submit(dialog.querySelector('form')!)
    const moved = draft('d1', { conversationId: all.conversationId })
    context.state.channels.set([all])
    context.state.conversations.set([conversation({ id: all.conversationId, kind: 'channel' })])
    context.state.threads.set(new Map([[all.conversationId, { notes: [moved], hasMore: false }]]))
    called('approveDraft')[0]!.then!.failed!({ _tag: 'Conflict', message: DRAFT_CHANGED })
    expect(dialog.open).toBe(true)
    expect(text.value).toBe('Ana’s edit')
    const alert = getByRole(dialog, 'alert')
    expect(textOf(alert)).toContain(strings.draftMovedWhileEditing)
    expect(textOf(alert)).toContain(strings.sendsToChannel({ channel: channelLabel('all-company') }))
    const send = getByRole(dialog, 'button', { name: strings.sendEdited }) as HTMLButtonElement
    const save = getByRole(dialog, 'button', { name: strings.saveDraft }) as HTMLButtonElement
    expect([send.disabled, save.disabled]).toEqual([true, true])
    getByRole(dialog, 'button', { name: strings.draftConfirmRoom }).click()
    expect([send.disabled, save.disabled]).toEqual([false, false])
    expect(queryByRole(dialog, 'button', { name: strings.draftConfirmRoom })).toBeNull()
    fire.submit(dialog.querySelector('form')!)
    expect(called('approveDraft')[1]!.args).toEqual([moved, 'Ana’s edit', []])
  })

  it('confirms a move to a room the page does not know yet without naming where it goes', () => {
    const { context, called } = testContext()
    const dialog = mount(dialogHost())
    const shown = mount(renderDraftsItem(context, draftsItemModel(threadInput(), item([draft('d1')]))))
    getByRole(shown, 'button', { name: strings.edit }).click()
    fire.submit(dialog.querySelector('form')!)
    const unknown = 'conv_unknown0000' as never
    context.state.threads.set(
      new Map([[unknown, { notes: [draft('d1', { conversationId: unknown })], hasMore: false }]]),
    )
    called('approveDraft')[0]!.then!.failed!({ _tag: 'Conflict', message: DRAFT_CHANGED })
    expect(dialog.querySelector('.draft-changed .draft-destination')).toBeNull()
    getByRole(dialog, 'button', { name: strings.draftConfirmRoom }).click()
    getByRole(dialog, 'button', { name: strings.saveDraft }).click()
    expect(called('saveDraft')[0]!.args[0]).toMatchObject({ conversationId: unknown })
  })
})
