import type { MemberId } from '@homingbird/protocol'
import { lifetime, signal } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import type { PickerCandidate } from '../../src/models/people-picker.ts'
import { strings } from '../../src/strings.ts'
import { peoplePicker } from '../../src/views/people-picker.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { BEN, CY } from '../support/fixtures.ts'

usingFakeDom()

const DEE = 'mem_dee000000000' as MemberId

const candidate = (memberId: MemberId, name: string, reason: string | null = null): PickerCandidate => ({
  memberId,
  name,
  email: `${name.toLowerCase()}@example.com`,
  presence: { humanOnline: true, agentOnline: true },
  reason,
})

const drawn = (limit: number | null = null) => {
  const chosen = signal<ReadonlyArray<MemberId>>([])
  const people = signal([
    candidate(BEN, 'Ben'),
    candidate(CY, 'Cy'),
    candidate(DEE, 'Dee', 'You blocked Dee.'),
  ])
  const parts = peoplePicker(lifetime(), {
    id: 'to',
    label: 'To',
    placeholder: 'Type a name',
    candidates: () => people.get(),
    sources: [people],
    chosen,
    limit,
  })
  mount(parts.element)
  const field = getByRole(parts.element, 'combobox', { name: 'To' }) as HTMLInputElement
  const options = () => [...parts.element.querySelectorAll('[role="option"]')]
  return { ...parts, field, chosen, people, options }
}

describe('peoplePicker', () => {
  it('suggests people once the field has the focus, with presence or the reason one cannot be chosen', () => {
    const { element, field, options } = drawn()
    expect(field.getAttribute('aria-expanded')).toBe('false')
    field.focus()
    expect(field.getAttribute('aria-expanded')).toBe('true')
    const listbox = getByRole(element, 'listbox', { name: strings.picker.suggestions })
    expect(field.getAttribute('aria-controls')).toBe(listbox.id)
    expect(field.getAttribute('aria-activedescendant')).toBe(`to-${BEN}`)
    expect(options().map((option) => option.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ])
    expect(textOf(options()[0]!)).toContain(strings.humanOnline)
    expect(options()[2]!.getAttribute('aria-disabled')).toBe('true')
    expect(textOf(options()[2]!)).toContain('You blocked Dee.')
    expect(textOf(element)).toContain(strings.picker.matches({ count: 3 }))
  })

  it('adds the person marked with the arrow keys on Enter, empties the field and keeps the focus', () => {
    const { element, field, chosen } = drawn()
    field.focus()
    fire.key(field, 'ArrowDown')
    expect(field.getAttribute('aria-activedescendant')).toBe(`to-${CY}`)
    expect(fire.key(field, 'Enter')).toBe(false)
    expect(chosen.get()).toEqual([CY])
    expect(field.value).toBe('')
    expect(document.activeElement).toBe(field)
    expect(field.getAttribute('aria-expanded')).toBe('false')
    expect(textOf(element.querySelector('.people-picker-chips')!)).toBe('Cy✕')
    fire.type(field, 'b')
    expect(field.getAttribute('aria-expanded')).toBe('true')
  })

  it('filters by what is typed, and adds nobody while an input method is still composing', () => {
    const { field, chosen, options } = drawn()
    field.focus()
    fire.type(field, '벤')
    expect(options()).toHaveLength(0)
    fire.type(field, 'be')
    expect(fire.key(field, 'Enter', { isComposing: true })).toBe(true)
    expect(chosen.get()).toEqual([])
    fire.key(field, 'Enter')
    expect(chosen.get()).toEqual([BEN])
  })

  it('adds a person who is clicked, but not one who cannot be chosen', () => {
    const { field, chosen, options } = drawn()
    field.focus()
    fire.click(options()[2]!)
    expect(chosen.get()).toEqual([])
    expect(fire.event(options()[1]!, 'pointerdown')).toBe(false)
    fire.click(options()[1]!)
    expect(chosen.get()).toEqual([CY])
  })

  it('takes a person out with their chip or with Backspace in the empty field', () => {
    const { element, field, chosen } = drawn()
    chosen.set([BEN, CY])
    getByRole(element, 'button', { name: strings.picker.remove({ name: 'Ben' }) }).click()
    expect(chosen.get()).toEqual([CY])
    fire.key(field, 'Backspace')
    expect(chosen.get()).toEqual([])
    expect(element.querySelector('.people-picker-chips')).toBeNull()
  })

  it('closes the suggestions on Escape or when the focus leaves, and says when it is full', () => {
    const { element, field, chosen } = drawn(1)
    field.focus()
    fire.key(field, 'Escape')
    expect(field.getAttribute('aria-expanded')).toBe('false')
    fire.key(field, 'ArrowDown')
    expect(field.getAttribute('aria-expanded')).toBe('true')
    fire.event(field, 'blur')
    expect(field.getAttribute('aria-expanded')).toBe('false')
    chosen.set([BEN])
    expect(textOf(element)).toContain(strings.picker.full({ count: 1 }))
    expect(field.hasAttribute('aria-activedescendant')).toBe(false)
    fire.key(field, 'a')
  })

  it('gives the focus to the field when the box around it is pressed', () => {
    const { element, field } = drawn()
    const box = element.querySelector('.people-picker-box')!
    fire.event(box, 'click')
    expect(document.activeElement).toBe(field)
  })
})
