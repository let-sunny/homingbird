import { fire, getByRole } from '@homingbird/ui/testing'
import { describe, expect, it, vi } from 'vitest'
import { strings } from '../../src/strings.ts'
import { type TodoList, todoList } from '../../src/views/todo-list.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const list = (fields: Partial<TodoList> = {}): TodoList => ({
  label: 'Steps',
  rows: [
    {
      key: 'a',
      name: 'First',
      enabled: true,
      fields: [{ name: 'text', label: 'Step', value: 'First', maxLength: 100, wide: true }],
    },
    {
      key: 'b',
      name: 'Second',
      enabled: false,
      fields: [{ name: 'text', label: 'Step', value: 'Second', maxLength: 100 }],
      problems: ['Too vague'],
      details: 'details',
    },
  ],
  toggle: vi.fn(),
  edit: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
  add: {
    label: 'Add step',
    fields: [{ name: 'text', label: 'New step', value: '', maxLength: 100, wide: true }],
    warnings: (values) => (values.text === 'vague' ? ['Be specific'] : []),
    submit: vi.fn((_, done: () => void) => done()),
  },
  ...fields,
})

describe('todoList', () => {
  it('switches, moves and deletes rows, with no move past either end', () => {
    const given = list()
    const shown = mount(todoList(given))
    getByRole(shown, 'switch', { name: strings.todo.use({ name: 'Second' }) }).click()
    expect(given.toggle).toHaveBeenCalledWith('b', true)
    expect(
      (getByRole(shown, 'button', { name: strings.todo.moveUp({ name: 'First' }) }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    getByRole(shown, 'button', { name: strings.todo.moveDown({ name: 'First' }) }).click()
    getByRole(shown, 'button', { name: strings.todo.moveUp({ name: 'Second' }) }).click()
    expect(given.move).toHaveBeenNthCalledWith(1, 'a', 1)
    expect(given.move).toHaveBeenNthCalledWith(2, 'b', 0)
    getByRole(shown, 'button', { name: strings.todo.more({ name: 'Second' }) }).click()
    getByRole(shown, 'button', { name: strings.todo.delete }).click()
    expect(given.remove).toHaveBeenCalledWith('b')
    expect(getByRole(shown, 'alert').textContent).toBe('Too vague')
  })

  it('saves a changed field, puts an empty or unchanged one back, and Escape undoes the typing', () => {
    const given = list()
    const shown = mount(todoList(given))
    const [first, second] = shown.querySelectorAll<HTMLTextAreaElement>('.todo-list .todo-field')
    fire.change(first!, ' Changed ')
    expect(given.edit).toHaveBeenCalledWith('a', 'text', 'Changed')
    fire.change(second!, '  ')
    expect(second!.value).toBe('Second')
    second!.focus()
    second!.value = 'Typed'
    fire.key(second!, 'Escape')
    expect(second!.value).toBe('Second')
    first!.focus()
    first!.value = 'Again'
    fire.key(first!, 'Enter')
    expect(given.edit).toHaveBeenCalledWith('a', 'text', 'Again')
    fire.key(first!, 'Enter', { shiftKey: true })
    fire.type(first!, 'one\ntwo\nthree')
    expect(first!.rows).toBe(3)
  })

  it('adds a row once every field is filled, warning while typing, and empties the add row after', () => {
    const given = list()
    const shown = mount(todoList(given))
    const add = getByRole(shown, 'group', { name: 'Add step' })
    const input = getByRole(add, 'textbox', { name: 'New step' }) as HTMLTextAreaElement
    getByRole(add, 'button', { name: 'Add step' }).click()
    expect(given.add.submit).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
    fire.type(input, 'vague')
    expect(add.querySelector('.todo-problems')!.textContent).toBe('Be specific')
    fire.key(input, 'Enter', { shiftKey: true })
    fire.key(input, 'Enter')
    expect(given.add.submit).toHaveBeenCalledWith({ text: 'vague' }, expect.any(Function))
    expect(input.value).toBe('')
  })

  it('works without warnings and with plain inputs', () => {
    const given = list({
      add: {
        label: 'Add',
        fields: [{ name: 'topic', label: 'Topic', value: 'x', maxLength: 10, placeholder: 'Topic' }],
        submit: vi.fn(),
      },
    })
    const shown = mount(todoList(given))
    const input = getByRole(shown, 'textbox', { name: 'Topic' })
    fire.type(input, 'y')
    expect(shown.querySelector('.todo-add .todo-problems')!.childNodes).toHaveLength(0)
  })
})
