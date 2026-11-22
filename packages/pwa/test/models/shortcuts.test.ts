import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type KeyPress, isTextEntry, shortcutOf, switcherShortcut } from '../../src/models/shortcuts.ts'

const press = (fields: Partial<KeyPress> = {}): KeyPress => ({
  key: 'k',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  target: { tagName: 'BODY', isContentEditable: false },
  ...fields,
})

describe('shortcutOf', () => {
  it('opens the switcher on Cmd+K, Ctrl+K and a slash', () => {
    expect(shortcutOf(press({ metaKey: true }))).toBe('switcher')
    expect(shortcutOf(press({ ctrlKey: true, key: 'K' }))).toBe('switcher')
    expect(shortcutOf(press({ key: '/' }))).toBe('switcher')
    expect(shortcutOf(press({ key: '/', shiftKey: true }))).toBe('switcher')
    expect(shortcutOf(press({ key: '/', target: null }))).toBe('switcher')
  })

  it('leaves other keys and other combinations alone', () => {
    expect(shortcutOf(press())).toBeNull()
    expect(shortcutOf(press({ metaKey: true, shiftKey: true }))).toBeNull()
    expect(shortcutOf(press({ metaKey: true, altKey: true }))).toBeNull()
    expect(shortcutOf(press({ key: '/', ctrlKey: true }))).toBeNull()
    expect(shortcutOf(press({ key: 'Escape' }))).toBeNull()
  })

  it('never fires while the person types in a field or an input method composes', () => {
    const typing = [
      { tagName: 'TEXTAREA', isContentEditable: false },
      { tagName: 'INPUT', type: 'search', isContentEditable: false },
      { tagName: 'INPUT', isContentEditable: false },
      { tagName: 'SELECT', isContentEditable: false },
      { tagName: 'DIV', isContentEditable: true },
    ]
    fc.assert(
      fc.property(
        fc.constantFrom(...typing),
        fc.constantFrom('/', 'k'),
        fc.boolean(),
        fc.boolean(),
        (target, key, metaKey, ctrlKey) => {
          expect(shortcutOf(press({ target, key, metaKey, ctrlKey }))).toBeNull()
        },
      ),
    )
    expect(shortcutOf(press({ key: '/', isComposing: true }))).toBeNull()
  })
})

describe('isTextEntry', () => {
  it('tells fields that take typing from controls that only take a press', () => {
    expect(isTextEntry(null)).toBe(false)
    expect(isTextEntry({ tagName: 'INPUT', type: 'checkbox', isContentEditable: false })).toBe(false)
    expect(isTextEntry({ tagName: 'BUTTON', isContentEditable: false })).toBe(false)
    expect(isTextEntry({ tagName: 'INPUT', type: 'email', isContentEditable: false })).toBe(true)
  })
})

describe('switcherShortcut', () => {
  it('writes the shortcut as the keyboard labels it', () => {
    expect(switcherShortcut(true)).toBe('⌘K')
    expect(switcherShortcut(false)).toBe('Ctrl+K')
  })
})
