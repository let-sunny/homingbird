/**
 * The keyboard shortcuts of the whole page: Cmd/Ctrl+K and `/` open the switcher. None fires while the
 * person types in a field or an input method composes, so a `/` or a K always reaches the text; Escape
 * is left to the dialog or menu that is open.
 */
export const shortcutOf = (press: KeyPress): Shortcut | null => {
  if (press.isComposing || isTextEntry(press.target)) return null
  if (press.altKey) return null
  const withCommand = press.metaKey || press.ctrlKey
  if (withCommand && !press.shiftKey && press.key.toLowerCase() === 'k') return 'switcher'
  if (!withCommand && press.key === '/') return 'switcher'
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
