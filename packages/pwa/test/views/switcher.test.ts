import type { ConversationId } from '@homingbird/protocol'
import { lifetime, signal } from '@homingbird/ui'
import { allByRole, fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { NOTHING_WAITS, type Waiting } from '../../src/models/waiting.ts'
import { strings } from '../../src/strings.ts'
import { switcher } from '../../src/views/switcher.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, ROOM, channel, conversation, entry, me } from '../support/fixtures.ts'

usingFakeDom()

const GROUP = 'conv_group0000000' as ConversationId

const start = (waiting: Waiting = NOTHING_WAITS) => {
  const test = testContext()
  const { state } = test.context
  state.session.set(me())
  state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy')])
  state.channels.set([channel('billing', { joined: true }), channel('secret', { visibility: 'private' })])
  state.conversations.set([
    conversation({ lastActivityAt: 9 }),
    conversation({ id: GROUP, kind: 'group', participantIds: [ANA, BEN, CY], lastActivityAt: 5 }),
  ])
  const life = lifetime()
  const dialog = mount(switcher(test.context, life, me(), signal(waiting)))
  const field = getByRole(dialog, 'combobox')
  return { ...test, dialog, field, life }
}

const optionNames = (dialog: HTMLElement) => allByRole(dialog, 'option').map((option) => textOf(option))

describe('switcher', () => {
  it('opens on Ctrl+K with what waits, then recent rooms, and the shortcuts in its footer', () => {
    const waiting: Waiting = {
      ...NOTHING_WAITS,
      places: [
        {
          key: ROOM,
          conversationId: ROOM,
          text: strings.activity.withPeople({ names: 'Ben' }),
          href: `#/c/${ROOM}?draft=note_d1`,
          why: strings.activity.groups.drafts,
        },
      ],
    }
    const { dialog, field } = start(waiting)
    expect(dialog.open).toBe(false)
    fire.key(document.body, 'k', { ctrlKey: true })
    expect(dialog.open).toBe(true)
    expect(document.activeElement).toBe(field)
    expect(field.getAttribute('aria-label')).toBe(strings.switcher.label)
    expect(textOf(dialog)).toContain(strings.switcher.waiting)
    expect(optionNames(dialog)).toEqual([
      `${strings.activity.withPeople({ names: 'Ben' })}${strings.activity.groups.drafts}`,
      'Ben, Cy',
    ])
    expect(field.getAttribute('aria-activedescendant')).toBe('switcher-option-0')
    expect(textOf(dialog)).toContain(strings.switcher.footer({ open: 'Ctrl+K' }))
  })

  it('opens on a slash too, and writes the shortcut with ⌘ on an Apple keyboard', () => {
    const { dialog, page } = start()
    page.state.apple = true
    fire.key(document.body, '/')
    expect(dialog.open).toBe(true)
    expect(textOf(dialog)).toContain(strings.switcher.footer({ open: '⌘K' }))
  })

  it('searches people, channels and group messages as the person types, never a private channel they are not in', () => {
    const { dialog, field } = start()
    fire.key(document.body, 'k', { metaKey: true })
    fire.type(field, 'e')
    expect(textOf(dialog)).not.toContain('#secret')
    fire.type(field, 'secret')
    expect(textOf(dialog)).toContain(strings.switcher.none({ query: 'secret' }))
    expect(field.hasAttribute('aria-activedescendant')).toBe(false)
    fire.type(field, 'bil')
    expect(optionNames(dialog)).toEqual([`#billing${'About billing'}`])
  })

  it('chooses with the arrow keys and goes there with Enter, closing itself', () => {
    const { dialog, field, page } = start()
    fire.key(document.body, 'k', { ctrlKey: true })
    fire.type(field, 'b')
    fire.key(field, 'ArrowDown')
    expect(field.getAttribute('aria-activedescendant')).toBe('switcher-option-1')
    fire.key(field, 'ArrowUp')
    fire.key(field, 'ArrowUp')
    expect(field.getAttribute('aria-activedescendant')).toBe('switcher-option-2')
    expect(getByRole(dialog, 'option', { name: /Ben, Cy/ }).getAttribute('aria-selected')).toBe('true')
    fire.key(field, 'Enter', { isComposing: true })
    expect(dialog.open).toBe(true)
    fire.key(field, 'Enter')
    expect(dialog.open).toBe(false)
    expect(page.visited).toEqual([`go #/c/${GROUP}`])
  })

  it('does nothing on Enter when nothing matches', () => {
    const { dialog, field, page } = start()
    fire.key(document.body, 'k', { ctrlKey: true })
    fire.type(field, 'zed')
    fire.key(field, 'Enter')
    expect(dialog.open).toBe(true)
    expect(page.visited).toEqual([])
  })

  it('starts a direct message with someone the person has none with, from a click', () => {
    const { context, dialog, field, called } = start()
    context.state.conversations.set([])
    fire.key(document.body, 'k', { ctrlKey: true })
    fire.type(field, 'cy')
    const option = getByRole(dialog, 'option', { name: /Cy/ })
    expect(fire.event(option, 'mousedown')).toBe(false)
    option.click()
    expect(called('openConversationWith').map((call) => call.args)).toEqual([[CY]])
    expect(dialog.open).toBe(false)
  })

  it('keeps a slash in the composer, opens from it on the command shortcut, and not while an input method composes', () => {
    const { dialog, page } = start()
    const composer = mount(document.createElement('textarea'))
    fire.key(composer, '/')
    fire.key(composer, 'k', { ctrlKey: true, isComposing: true })
    fire.key(document.body, '/', { isComposing: true })
    fire.key(document.body, 'a')
    page.state.apple = true
    fire.key(composer, 'k', { ctrlKey: true })
    expect(dialog.open).toBe(false)
    fire.key(composer, 'k', { metaKey: true })
    expect(dialog.open).toBe(true)
    dialog.close()
    page.state.apple = false
    fire.key(composer, 'k', { ctrlKey: true })
    expect(dialog.open).toBe(true)
    dialog.close()
    fire.key(document.body, '/')
    const again = fire.key(document.body, '/')
    expect(again).toBe(true)
    const field = getByRole(dialog, 'combobox')
    fire.type(field, 'b')
    expect(fire.key(field, 'b')).toBe(true)
    expect(dialog.open).toBe(true)
  })

  it('shows the chosen option once it is drawn, and reads a document-wide key without an element', () => {
    const { dialog, field, page } = start()
    fire.key(document.body, 'k', { ctrlKey: true })
    fire.key(field, 'ArrowDown')
    page.runFrames()
    expect(getByRole(dialog, 'option', { name: /Ben, Cy/ }).getAttribute('aria-selected')).toBe('true')
    dialog.close()
    fire.key(document, '/')
    expect(dialog.open).toBe(true)
  })

  it('keeps its list when opened again before the close event of the last choice arrives', () => {
    const { dialog } = start()
    fire.key(document.body, 'k', { ctrlKey: true })
    dialog.close()
    fire.key(document.body, 'k', { ctrlKey: true })
    fire.event(dialog, 'close')
    expect(dialog.open).toBe(true)
    expect(dialog.querySelector('.switcher-foot')).not.toBeNull()
    dialog.close()
    fire.event(dialog, 'close')
    expect(dialog.querySelector('.switcher-foot')).toBeNull()
  })

  it('stops listening for its shortcuts once its page is gone', () => {
    const { dialog, life } = start()
    life.end()
    fire.key(document.body, 'k', { ctrlKey: true })
    expect(dialog.open).toBe(false)
  })
})
