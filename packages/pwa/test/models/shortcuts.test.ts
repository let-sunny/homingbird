import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type KeyPress, isTextEntry, shortcutOf, switcherShortcut } from '../../src/models/shortcuts.ts'

const press = (fields: Partial<KeyPress> = {}): KeyPress => ({
  isApple: false,
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

  it('keeps a slash in the field the person types in, and never fires while an input method composes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TYPING),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (target, isApple, metaKey, ctrlKey) => {
          expect(shortcutOf(press({ target, isApple, key: '/' }))).toBeNull()
          expect(shortcutOf(press({ isApple, metaKey, ctrlKey, isComposing: true }))).toBeNull()
          expect(shortcutOf(press({ target, isApple, metaKey, ctrlKey, isComposing: true }))).toBeNull()
        },
      ),
    )
    expect(shortcutOf(press({ key: '/', isComposing: true }))).toBeNull()
  })

  it('opens from a field on Cmd+K, and on Ctrl+K only off an Apple keyboard, where it edits text', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TYPING), (target) => {
        expect(shortcutOf(press({ target, isApple: true, metaKey: true }))).toBe('switcher')
        expect(shortcutOf(press({ target, isApple: true, ctrlKey: true }))).toBeNull()
        expect(shortcutOf(press({ target, isApple: true, metaKey: true, ctrlKey: true }))).toBeNull()
        expect(shortcutOf(press({ target, isApple: false, ctrlKey: true }))).toBe('switcher')
        expect(shortcutOf(press({ target, isApple: false, metaKey: true }))).toBeNull()
      }),
    )
    expect(shortcutOf(press({ isApple: true, ctrlKey: true }))).toBe('switcher')
  })
})

const TYPING = [
  { tagName: 'TEXTAREA', isContentEditable: false },
  { tagName: 'INPUT', type: 'search', isContentEditable: false },
  { tagName: 'INPUT', isContentEditable: false },
  { tagName: 'SELECT', isContentEditable: false },
  { tagName: 'DIV', isContentEditable: true },
]

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
