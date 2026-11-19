import { strings } from '../strings.ts'

/** The words and the enabled moves of one row of a to-do list, by its place in the list. */
export const todoRowModel = (name: string, enabled: boolean, index: number, count: number): TodoRowModel => ({
  className: `todo-row${enabled ? '' : ' is-off'}`,
  check: enabled ? '✓' : '',
  switchLabel: strings.todo.use({ name }),
  moveUp: { label: strings.todo.moveUp({ name }), disabled: index === 0, to: index - 1 },
  moveDown: { label: strings.todo.moveDown({ name }), disabled: index === count - 1, to: index + 1 },
  moreLabel: strings.todo.more({ name }),
})

/** The value to save from an edited field: none when it is empty or unchanged, which puts the old one back. */
export const editedValue = (saved: string, typed: string): string | null => {
  const value = typed.trim()
  return value === saved || value === '' ? null : value
}

/** Rows for a text without `field-sizing`, so it never hides a line; the stylesheet's sizing wins where supported. */
export const rowsFor = (text: string): number =>
  Math.max(
    2,
    text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / ROW_CHARACTERS)), 0),
  )

export interface TodoRowModel {
  readonly className: string
  readonly check: string
  readonly switchLabel: string
  readonly moveUp: { readonly label: string; readonly disabled: boolean; readonly to: number }
  readonly moveDown: { readonly label: string; readonly disabled: boolean; readonly to: number }
  readonly moreLabel: string
}

/** Characters a narrow row holds, kept low so the fallback errs towards an empty line rather than a hidden one. */
const ROW_CHARACTERS = 28
