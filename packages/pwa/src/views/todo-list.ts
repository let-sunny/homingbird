import { type Child, h } from '@homingbird/ui'
import { strings } from '../strings.ts'
import { button } from './parts.ts'

export interface TodoField {
  readonly name: string
  readonly label: string
  readonly value: string
  readonly maxLength: number
  readonly placeholder?: string
  readonly wide?: boolean
}

export interface TodoRow {
  readonly key: string
  readonly name: string
  readonly enabled: boolean
  readonly fields: ReadonlyArray<TodoField>
  readonly details?: Child
  readonly problems?: ReadonlyArray<string>
  readonly menu?: ReadonlyArray<HTMLElement>
  readonly aside?: HTMLElement
}

export interface TodoList {
  readonly label: string
  readonly rows: ReadonlyArray<TodoRow>
  readonly toggle: (key: string, enabled: boolean) => void
  readonly edit: (key: string, field: string, value: string) => void
  readonly move: (key: string, to: number) => void
  readonly remove: (key: string) => void
  readonly add: {
    readonly label: string
    readonly fields: ReadonlyArray<TodoField>
    readonly extra?: Child
    readonly warnings?: (values: Readonly<Record<string, string>>) => ReadonlyArray<string>
    readonly submit: (values: Readonly<Record<string, string>>, done: () => void) => void
  }
}

/**
 * A list kept like a to-do list: a switch per row, text edited in place, up and down to set the order,
 * delete in a row's menu, and an add row at the end.
 */
export const todoList = (list: TodoList): HTMLElement =>
  h(
    'div',
    { class: 'todo' },
    h(
      'ol',
      { class: 'todo-list', 'aria-label': list.label },
      list.rows.map((row, index) => todoRow(list, row, index)),
    ),
    addRow(list),
  )

const todoRow = (list: TodoList, row: TodoRow, index: number): HTMLElement => {
  const menuId = `todo-menu-${row.key}`
  return h(
    'li',
    { class: `todo-row${row.enabled ? '' : ' is-off'}`, data: { key: row.key, name: row.name } },
    h(
      'button',
      {
        type: 'button',
        class: 'todo-switch',
        role: 'switch',
        'aria-checked': String(row.enabled),
        'aria-label': strings.todo.use({ name: row.name }),
        on: { click: () => list.toggle(row.key, !row.enabled) },
      },
      h('span', { class: 'todo-check', 'aria-hidden': 'true' }, row.enabled ? '✓' : ''),
    ),
    h(
      'div',
      { class: 'todo-main' },
      h(
        'div',
        { class: 'todo-fields' },
        row.fields.map((field) => editableField(field, (value) => list.edit(row.key, field.name, value))),
      ),
      row.problems !== undefined &&
        row.problems.length > 0 &&
        h(
          'ul',
          { class: 'todo-problems', role: 'alert' },
          row.problems.map((problem) => h('li', {}, problem)),
        ),
      row.details !== undefined && h('div', { class: 'todo-details' }, row.details),
    ),
    h(
      'div',
      { class: 'todo-tools' },
      row.aside,
      button('↑', () => list.move(row.key, index - 1), {
        class: 'todo-move',
        'aria-label': strings.todo.moveUp({ name: row.name }),
        disabled: index === 0,
      }),
      button('↓', () => list.move(row.key, index + 1), {
        class: 'todo-move',
        'aria-label': strings.todo.moveDown({ name: row.name }),
        disabled: index === list.rows.length - 1,
      }),
      h(
        'button',
        {
          type: 'button',
          class: 'todo-more',
          popovertarget: menuId,
          'aria-label': strings.todo.more({ name: row.name }),
        },
        '⋯',
      ),
      h(
        'div',
        { id: menuId, class: 'menu todo-menu', popover: 'auto' },
        ...(row.menu ?? []),
        button(strings.todo.delete, () => list.remove(row.key), { class: 'menu-item danger' }),
      ),
    ),
  )
}

const editableField = (field: TodoField, save: (value: string) => void): HTMLElement => {
  const control = h(field.wide === true ? 'textarea' : 'input', {
    class: `todo-field is-${field.name}`,
    name: field.name,
    'aria-label': field.label,
    maxlength: String(field.maxLength),
  }) as HTMLInputElement | HTMLTextAreaElement
  control.value = field.value
  if (control instanceof HTMLTextAreaElement) growsWithText(control)
  const commit = (): void => {
    const value = control.value.trim()
    if (value === field.value || value === '') {
      control.value = field.value
      return
    }
    save(value)
  }
  control.addEventListener('change', commit)
  control.addEventListener('keydown', (event: Event) => {
    if (!(event instanceof KeyboardEvent)) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      control.blur()
    }
    if (event.key === 'Escape') control.value = field.value
  })
  return control
}

const addRow = (list: TodoList): HTMLElement => {
  const controls = list.add.fields.map((field) => {
    const control = h(field.wide === true ? 'textarea' : 'input', {
      class: `todo-field is-${field.name}`,
      name: field.name,
      'aria-label': field.label,
      placeholder: field.placeholder ?? '',
      maxlength: String(field.maxLength),
    }) as HTMLInputElement | HTMLTextAreaElement
    control.value = field.value
    if (control instanceof HTMLTextAreaElement) growsWithText(control)
    return [field.name, control] as const
  })
  const warnings = h('ul', { class: 'todo-problems', 'aria-live': 'polite' })
  const valuesOf = (): Record<string, string> =>
    Object.fromEntries(controls.map(([name, control]) => [name, control.value.trim()]))
  const reflect = (): void => {
    warnings.replaceChildren(
      ...(list.add.warnings?.(valuesOf()) ?? []).map((warning) => h('li', {}, warning)),
    )
  }
  for (const [, control] of controls) control.addEventListener('input', reflect)
  const submit = (): void => {
    if (controls.some(([, control]) => control.value.trim() === '')) {
      controls.find(([, control]) => control.value.trim() === '')?.[1].focus()
      return
    }
    list.add.submit(valuesOf(), () => {
      for (const [, control] of controls) control.value = ''
      reflect()
      controls[0]?.[1].focus()
    })
  }
  for (const [, control] of controls)
    control.addEventListener('keydown', (event: Event) => {
      if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        submit()
      }
    })
  return h(
    'div',
    { class: 'todo-add', role: 'group', 'aria-label': list.add.label },
    h('span', { class: 'todo-plus', 'aria-hidden': 'true' }, '+'),
    h(
      'div',
      { class: 'todo-fields' },
      controls.map(([, control]) => control),
    ),
    list.add.extra,
    button(list.add.label, submit, { class: 'primary todo-add-button' }),
    warnings,
  )
}

/** Rows for a text without `field-sizing`, so it never hides a line; the stylesheet's sizing wins where supported. */
export const rowsFor = (text: string): number =>
  Math.max(
    2,
    text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / ROW_CHARACTERS)), 0),
  )

/** Characters a narrow row holds, kept low so the fallback errs towards an empty line rather than a hidden one. */
const ROW_CHARACTERS = 28

const growsWithText = (control: HTMLTextAreaElement): void => {
  control.rows = rowsFor(control.value)
  control.addEventListener('input', () => {
    control.rows = rowsFor(control.value)
  })
}
