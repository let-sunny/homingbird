import { type Child, h } from '@homingbird/ui'
import { editedValue, rowsFor, todoRowModel } from '../models/todo-list.ts'
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
  readonly aside?: Child
}

export interface TodoList {
  readonly label: string
  readonly rows: ReadonlyArray<TodoRow>
  readonly toggle: (key: string, enabled: boolean) => void
  readonly edit: (key: string, field: string, value: string) => void
  readonly move: (key: string, to: number) => void
  readonly remove: (key: string) => void
  /** A `todoAddRow`, kept by whoever draws the list again, so that what is typed in it stays. */
  readonly add: HTMLElement
}

export interface TodoAdd {
  readonly label: string
  readonly fields: ReadonlyArray<TodoField>
  /** More controls beside the fields; given a way to show the warnings again when one of them changes. */
  readonly extra?: (reflect: () => void) => Child
  readonly warnings?: (values: Readonly<Record<string, string>>) => ReadonlyArray<string>
  readonly submit: (values: Readonly<Record<string, string>>, done: () => void) => void
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
    list.add,
  )

export const todoAddRow = (add: TodoAdd): HTMLElement => {
  const controls = add.fields.map((field) => {
    const control = h(field.wide === true ? 'textarea' : 'input', {
      class: `todo-field is-${field.name}`,
      name: field.name,
      'aria-label': field.label,
      placeholder: field.placeholder ?? '',
      maxlength: String(field.maxLength),
    }) as HTMLInputElement | HTMLTextAreaElement
    control.value = field.value
    if (field.wide === true) growsWithText(control)
    return [field.name, control] as const
  })
  const warnings = h('ul', { class: 'todo-problems', 'aria-live': 'polite' })
  const valuesOf = (): Record<string, string> =>
    Object.fromEntries(controls.map(([name, control]) => [name, control.value.trim()]))
  const reflect = (): void => {
    warnings.replaceChildren(...(add.warnings?.(valuesOf()) ?? []).map((warning) => h('li', {}, warning)))
  }
  for (const [, control] of controls) control.addEventListener('input', reflect)
  const submit = (): void => {
    if (controls.some(([, control]) => control.value.trim() === '')) {
      controls.find(([, control]) => control.value.trim() === '')?.[1].focus()
      return
    }
    add.submit(valuesOf(), () => {
      for (const [, control] of controls) control.value = ''
      reflect()
      controls[0]?.[1].focus()
    })
  }
  for (const [, control] of controls)
    control.addEventListener('keydown', (event) => {
      const key = event as KeyboardEvent
      if (key.key === 'Enter' && !key.shiftKey) {
        event.preventDefault()
        submit()
      }
    })
  return h(
    'div',
    { class: 'todo-add', role: 'group', 'aria-label': add.label },
    h('span', { class: 'todo-plus', 'aria-hidden': 'true' }, '+'),
    h(
      'div',
      { class: 'todo-fields' },
      controls.map(([, control]) => control),
    ),
    add.extra?.(reflect),
    button(add.label, submit, { class: 'primary todo-add-button' }),
    warnings,
  )
}

const todoRow = (list: TodoList, row: TodoRow, index: number): HTMLElement => {
  const menuId = `todo-menu-${row.key}`
  const model = todoRowModel(row.name, row.enabled, index, list.rows.length)
  return h(
    'li',
    { class: model.className, data: { key: row.key, name: row.name } },
    h(
      'button',
      {
        type: 'button',
        class: 'todo-switch',
        role: 'switch',
        'aria-checked': String(row.enabled),
        'aria-label': model.switchLabel,
        on: { click: () => list.toggle(row.key, !row.enabled) },
      },
      h('span', { class: 'todo-check', 'aria-hidden': 'true' }, model.check),
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
      button('↑', () => list.move(row.key, model.moveUp.to), {
        class: 'todo-move',
        'aria-label': model.moveUp.label,
        disabled: model.moveUp.disabled,
      }),
      button('↓', () => list.move(row.key, model.moveDown.to), {
        class: 'todo-move',
        'aria-label': model.moveDown.label,
        disabled: model.moveDown.disabled,
      }),
      h(
        'button',
        { type: 'button', class: 'todo-more', popovertarget: menuId, 'aria-label': model.moreLabel },
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
  if (field.wide === true) growsWithText(control)
  const commit = (): void => {
    const value = editedValue(field.value, control.value)
    if (value === null) control.value = field.value
    else save(value)
  }
  control.addEventListener('change', commit)
  control.addEventListener('keydown', (event) => {
    const key = event as KeyboardEvent
    if (key.key === 'Enter' && !key.shiftKey) {
      event.preventDefault()
      control.blur()
    }
    if (key.key === 'Escape') control.value = field.value
  })
  return control
}

const growsWithText = (control: HTMLInputElement | HTMLTextAreaElement): void => {
  const area = control as HTMLTextAreaElement
  area.rows = rowsFor(area.value)
  area.addEventListener('input', () => {
    area.rows = rowsFor(area.value)
  })
}
