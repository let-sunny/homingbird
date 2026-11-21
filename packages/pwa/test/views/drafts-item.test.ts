import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { channelLabel } from '../../src/channels.ts'
import { heldWordsFor } from '../../src/held-decisions.ts'
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
  it('names each draft by what waits and where it came from, for a screen reader', () => {
    const { context } = testContext()
    const [a, b] = [draft('d1'), draft('d2')]
    const model = draftsItemModel(threadInput(), item([a, b]))
    const shown = mount(renderDraftsItem(context, model))
    for (const [index, card] of [...shown.querySelectorAll('article.draft')].entries()) {
      const names = card
        .getAttribute('aria-labelledby')!
        .split(' ')
        .map((id) => textOf(document.getElementById(id)!))
      expect(names).toEqual([model.heading, model.cards[index]!.origin.text])
    }
  })

  it('holds a send, edited or as written, and a discard, Send first and Discard set apart at the end', () => {
    const { context, called } = testContext()
    const dialog = mount(dialogHost())
    const [a, b] = [draft('d1'), draft('d2')]
    context.state.threads.set(new Map([[ROOM, { notes: [a, b], hasMore: false }]]))
    const model = draftsItemModel(threadInput(), item([a, b]))
    const held = model.cards[0]!.actions!.held
    const shown = mount(renderDraftsItem(context, model))
    const card = shown.querySelector('[data-draft-id="d1"]')!
    const buttons = [...card.querySelectorAll('.draft-actions button')]
    expect(buttons.map((button) => textOf(button))).toEqual([
      strings.approveAndSend,
      strings.edit,
      strings.discard,
    ])
    expect(buttons.at(-1)!.classList.contains('draft-discard')).toBe(true)
    getByRole(card, 'button', { name: strings.approveAndSend }).click()
    expect(called('holdSend')[0]!.args).toEqual([a, null, [b], held.send])
    expect(called('holdSend')[0]!.then!.attempt).toBe('draft')
    getByRole(card, 'button', { name: strings.edit }).click()
    expect(document.activeElement).toBe(getByRole(dialog, 'textbox', { name: strings.editDraftLabel }))
    fire.type(getByRole(dialog, 'textbox', { name: strings.editDraftLabel }), 'Edited')
    getByRole(dialog, 'button', { name: strings.saveDraft }).click()
    expect(called('saveDraft')[0]!.args).toEqual([a, 'Edited'])
    fire.submit(dialog.querySelector('form')!)
    expect(called('holdSend')[1]!.args).toEqual([a, 'Edited', [b], held.send])
    expect(dialog.open).toBe(false)
    expect(called('keepDraftEdit').map((call) => call.args)).toEqual([['d1', a.body, 'Edited']])
    getByRole(card, 'button', { name: strings.discard }).click()
    expect(called('holdDiscard')[0]!.args).toEqual([a, held.discard])
    expect(held).toEqual(heldWordsFor('Ben'))
  })

  it('keeps an edit closed without sending, opens Edit with it, says so on the card, and sends it on Cmd or Ctrl+Enter', () => {
    const { context, called } = testContext()
    const dialog = mount(dialogHost())
    const a = draft('d1')
    context.state.threads.set(new Map([[ROOM, { notes: [a], hasMore: false }]]))
    const plain = mount(renderDraftsItem(context, draftsItemModel(threadInput(), item([a]))))
    getByRole(plain, 'button', { name: strings.edit }).click()
    const text = getByRole(dialog, 'textbox', { name: strings.editDraftLabel }) as HTMLTextAreaElement
    fire.type(text, 'Half an edit')
    getByRole(dialog, 'button', { name: strings.cancel }).click()
    expect(called('keepDraftEdit').map((call) => call.args)).toEqual([['d1', a.body, 'Half an edit']])
    const edits = new Map([['d1' as never, 'Half an edit']])
    const kept = mount(
      renderDraftsItem(context, draftsItemModel(threadInput({ draftEdits: edits }), item([a]))),
    )
    expect(textOf(kept)).toContain(strings.draftEditKept)
    getByRole(kept, 'button', { name: strings.edit }).click()
    const again = getByRole(dialog, 'textbox', { name: strings.editDraftLabel }) as HTMLTextAreaElement
    expect(again.value).toBe('Half an edit')
    fire.key(again, 'Enter')
    expect(called('holdSend')).toHaveLength(0)
    fire.key(again, 'Enter', { ctrlKey: true })
    expect(called('holdSend')[0]!.args[1]).toBe('Half an edit')
  })

  it('lets a saved edit go, as the draft now holds it', () => {
    const { context, called } = testContext()
    const dialog = mount(dialogHost())
    const a = draft('d1')
    const shown = mount(renderDraftsItem(context, draftsItemModel(threadInput(), item([a]))))
    getByRole(shown, 'button', { name: strings.edit }).click()
    fire.type(getByRole(dialog, 'textbox', { name: strings.editDraftLabel }), 'Saved words')
    getByRole(dialog, 'button', { name: strings.saveDraft }).click()
    called('saveDraft')[0]!.then!.done!(undefined)
    expect(dialog.open).toBe(false)
    expect(called('keepDraftEdit').map((call) => call.args)).toEqual([['d1', 'Saved words', 'Saved words']])
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

  it('links a debate room’s result to its room instead of a basis', () => {
    const { context } = testContext()
    const fromDebate = { debateId: 'deb_room00000000' as never, question: 'Ship?', agents: [] }
    const shown = mount(
      renderDraftsItem(
        context,
        draftsItemModel(threadInput(), item([draft('d1', { agentName: null, basis: null, fromDebate })])),
      ),
    )
    expect(shown.querySelector('.draft-basis')).toBeNull()
    expect(textOf(shown)).not.toContain(strings.draftBasisMissing)
    expect(getByRole(shown, 'link', { name: strings.debateNote.openRoom }).getAttribute('href')).toBe(
      '#/debate/deb_room00000000/result',
    )
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

  it('closes the editor without sending once the draft it started from was sent or discarded elsewhere', () => {
    const { context, called } = testContext()
    const dialog = mount(dialogHost())
    const shown = mount(renderDraftsItem(context, draftsItemModel(threadInput(), item([draft('d1')]))))
    getByRole(shown, 'button', { name: strings.edit }).click()
    fire.submit(dialog.querySelector('form')!)
    expect([dialog.open, called('holdSend').length]).toEqual([false, 0])
  })

  it('shows each source as a link, a jump to an earlier note, or words, with the passage it used', () => {
    const { context } = testContext()
    const sources = [
      { url: 'https://wiki.example.com/refunds', quote: 'Five days.' },
      { noteId: 'note_earlier0000' as never, conversationId: ROOM },
    ]
    const shown = mount(
      renderDraftsItem(context, draftsItemModel(threadInput(), item([draft('d1', { basis: '', sources })]))),
    )
    const links = [...shown.querySelectorAll('.draft-sources a')] as HTMLAnchorElement[]
    expect(links.map((link) => [textOf(link), link.getAttribute('href'), link.getAttribute('rel')])).toEqual([
      ['https://wiki.example.com/refunds', 'https://wiki.example.com/refunds', 'noopener noreferrer'],
      [strings.sourceNote, `#/c/${ROOM}?note=note_earlier0000`, null],
    ])
    expect(textOf(shown.querySelector('.source-quote')!)).toBe('Five days.')
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
    expect(queryByRole(shown, 'button', { name: strings.approveAndSend })).toBeNull()
    expect(queryByRole(shown, 'button', { name: strings.edit })).toBeNull()
    getByRole(shown, 'button', { name: strings.draftReadAgain }).click()
    expect(called('confirmDraftRead')[0]!.args).toEqual([changed])
    getByRole(shown, 'button', { name: strings.discard }).click()
    expect(called('holdDiscard')[0]!.args).toEqual([changed, heldWordsFor('Ben').discard])
  })

  it('keeps the person’s edit when the agent changed the draft meanwhile, shows it as it is now, and sends from that', () => {
    const { context, called } = testContext()
    const dialog = mount(dialogHost())
    const read = draft('d1')
    const shown = mount(renderDraftsItem(context, draftsItemModel(threadInput(), item([read]))))
    getByRole(shown, 'button', { name: strings.edit }).click()
    const text = getByRole(dialog, 'textbox', { name: strings.editDraftLabel }) as HTMLTextAreaElement
    fire.type(text, 'Ana’s edit')
    const now = draft('d1', { body: 'rewritten by the agent' })
    context.state.threads.set(new Map([[ROOM, { notes: [now], hasMore: false }]]))
    fire.submit(dialog.querySelector('form')!)
    expect(called('holdSend')).toHaveLength(0)
    expect(dialog.open).toBe(true)
    expect(text.value).toBe('Ana’s edit')
    expect(textOf(getByRole(dialog, 'alert'))).toBe(
      `${strings.draftChangedWhileEditing}rewritten by the agent`,
    )
    fire.submit(dialog.querySelector('form')!)
    expect(called('holdSend')[0]!.args.slice(0, 3)).toEqual([now, 'Ana’s edit', []])
    expect(dialog.open).toBe(false)
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
    const moved = draft('d1', { conversationId: all.conversationId })
    context.state.channels.set([all])
    context.state.conversations.set([conversation({ id: all.conversationId, kind: 'channel' })])
    context.state.threads.set(new Map([[all.conversationId, { notes: [moved], hasMore: false }]]))
    fire.submit(dialog.querySelector('form')!)
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
    expect(called('holdSend')[0]!.args.slice(0, 3)).toEqual([moved, 'Ana’s edit', []])
  })

  it('confirms a move to a room the page does not know yet without naming where it goes', () => {
    const { context, called } = testContext()
    const dialog = mount(dialogHost())
    const shown = mount(renderDraftsItem(context, draftsItemModel(threadInput(), item([draft('d1')]))))
    getByRole(shown, 'button', { name: strings.edit }).click()
    const unknown = 'conv_unknown0000' as never
    context.state.threads.set(
      new Map([[unknown, { notes: [draft('d1', { conversationId: unknown })], hasMore: false }]]),
    )
    fire.submit(dialog.querySelector('form')!)
    expect(dialog.querySelector('.draft-changed .draft-destination')).toBeNull()
    getByRole(dialog, 'button', { name: strings.draftConfirmRoom }).click()
    getByRole(dialog, 'button', { name: strings.saveDraft }).click()
    expect(called('saveDraft')[0]!.args[0]).toMatchObject({ conversationId: unknown })
  })
})
