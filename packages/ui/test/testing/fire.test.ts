import { describe, expect, it, vi } from 'vitest'
import { fakeDocument } from '../../src/testing/fake-dom.ts'
import { fire } from '../../src/testing/fire.ts'

describe('fire', () => {
  it('types, commits and chooses values with the events a browser dispatches', () => {
    const document = fakeDocument()
    const input = document.createElement('input')
    const events: string[] = []
    for (const type of ['input', 'change', 'keydown', 'submit', 'pointerenter', 'click'])
      input.addEventListener(type, (event) => events.push(`${type}:${event.key}`))
    fire.type(input, 'ana')
    expect(input.value).toBe('ana')
    fire.change(input, 'ben')
    const select = document.createElement('select')
    for (const value of ['a', 'b']) {
      const option = document.createElement('option')
      option.value = value
      select.appendChild(option)
    }
    select.addEventListener('change', () => events.push(`select:${select.value}`))
    fire.select(select, 'b')
    expect(fire.key(input, 'Enter', { shiftKey: true })).toBe(true)
    fire.submit(input)
    fire.event(input, 'pointerenter', { pointerType: 'mouse' })
    fire.click(input)
    expect(events).toEqual([
      'input:',
      'input:',
      'change:',
      'select:b',
      'keydown:Enter',
      'submit:',
      'pointerenter:',
      'click:',
    ])
    const listener = vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
    input.addEventListener('keydown', listener)
    expect(fire.key(input, 'Escape')).toBe(false)
  })
})
