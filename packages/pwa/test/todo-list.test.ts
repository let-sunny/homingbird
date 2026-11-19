import { describe, expect, it } from 'vitest'
import { rowsFor } from '../src/views/todo-list.ts'

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
