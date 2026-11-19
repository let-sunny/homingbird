import { describe, expect, it } from 'vitest'
import { editedValue, rowsFor, todoRowModel } from '../../src/models/todo-list.ts'
import { strings } from '../../src/strings.ts'

describe('rowsFor', () => {
  it('gives at least two rows, and one more for every line a narrow row cannot hold', () => {
    expect(rowsFor('')).toBe(2)
    expect(rowsFor('check RELEASES.md')).toBe(2)
    expect(rowsFor('x'.repeat(28 * 3))).toBe(3)
    expect(rowsFor('x'.repeat(28 * 3 + 1))).toBe(4)
  })

  it('counts each line the person broke on its own', () => {
    expect(rowsFor('one\ntwo\nthree')).toBe(3)
    expect(rowsFor(`${'x'.repeat(29)}\nshort`)).toBe(3)
  })
})

describe('todoRowModel', () => {
  it('names each control after the row, and allows no move past either end', () => {
    expect(todoRowModel('Tone', true, 0, 2)).toEqual({
      className: 'todo-row',
      check: '✓',
      switchLabel: strings.todo.use({ name: 'Tone' }),
      moveUp: { label: strings.todo.moveUp({ name: 'Tone' }), disabled: true, to: -1 },
      moveDown: { label: strings.todo.moveDown({ name: 'Tone' }), disabled: false, to: 1 },
      moreLabel: strings.todo.more({ name: 'Tone' }),
    })
    expect(todoRowModel('Tone', false, 1, 2)).toMatchObject({
      className: 'todo-row is-off',
      check: '',
      moveUp: { disabled: false },
      moveDown: { disabled: true },
    })
  })
})

describe('editedValue', () => {
  it('saves a changed value without its spaces, and nothing for an unchanged or empty one', () => {
    expect(editedValue('Tone', ' Voice ')).toBe('Voice')
    expect(editedValue('Tone', ' Tone ')).toBeNull()
    expect(editedValue('Tone', '   ')).toBeNull()
  })
})
