/**
 * The keyboard shortcuts of the whole page: Cmd/Ctrl+K and `/` open the switcher. A `/` typed in a
 * field stays in the text. Cmd+K, and Ctrl+K off Apple keyboards, work in a field too, since they type
 * nothing there; on an Apple keyboard Ctrl+K deletes to the end of the line, so it is left to the field.
 * Nothing fires while an input method composes; Escape is left to the dialog or menu that is open.
 */
export const shortcutOf = (press: KeyPress): Shortcut | null => {
  if (press.isComposing || press.altKey) return null
  const typing = isTextEntry(press.target)
  const withCommand = press.metaKey || press.ctrlKey
  if (withCommand && !press.shiftKey && press.key.toLowerCase() === 'k')
    return !typing || (press.isApple ? press.metaKey && !press.ctrlKey : press.ctrlKey) ? 'switcher' : null
  if (!withCommand && !typing && press.key === '/') return 'switcher'
  return null
}

/** Whether keys pressed in this element are typed into it. */
export const isTextEntry = (target: KeyTarget | null): boolean => {
  if (target === null) return false
  if (target.isContentEditable) return true
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  return target.tagName === 'INPUT' && !NOT_TYPED_INTO.includes(target.type ?? 'text')
}

/** How the switcher's shortcut is written on this device. */
export const switcherShortcut = (isApple: boolean): string => (isApple ? '⌘K' : 'Ctrl+K')

export type Shortcut = 'switcher'

export interface KeyPress {
  /** Whether the keyboard has a Command key, where Ctrl+K edits text. */
  readonly isApple: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly isComposing: boolean
  readonly target: KeyTarget | null
}

export interface KeyTarget {
  readonly tagName: string
  readonly type?: string
  readonly isContentEditable: boolean
}

const NOT_TYPED_INTO: ReadonlyArray<string> = [
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]
