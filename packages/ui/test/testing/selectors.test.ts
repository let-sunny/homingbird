import { describe, expect, it } from 'vitest'
import { type FakeElement, fakeDocument } from '../../src/testing/fake-dom.ts'
import { matchesSelector } from '../../src/testing/selectors.ts'

const tree = () => {
  const document = fakeDocument()
  const form = document.createElement('form')
  form.className = 'form ask'
  const field = document.createElement('label')
  const input = document.createElement('input')
  input.setAttribute('name', 'q')
  input.setAttribute('data-tour', 'search box')
  input.id = 'query'
  field.appendChild(input)
  form.appendChild(field)
  document.body.appendChild(form)
  return { document, form, field, input }
}

describe('matchesSelector', () => {
  it('matches tags, ids, classes and the universal selector', () => {
    const { form, input } = tree()
    expect(matchesSelector(input, 'input')).toBe(true)
    expect(matchesSelector(input, 'INPUT#query')).toBe(true)
    expect(matchesSelector(form, '.form.ask')).toBe(true)
    expect(matchesSelector(form, '.form.other')).toBe(false)
    expect(matchesSelector(form, '*')).toBe(true)
    expect(matchesSelector(input, '#other')).toBe(false)
  })

  it('matches attributes with each operator', () => {
    const { input } = tree()
    expect(matchesSelector(input, '[name]')).toBe(true)
    expect(matchesSelector(input, '[name="q"]')).toBe(true)
    expect(matchesSelector(input, "[name='q']")).toBe(true)
    expect(matchesSelector(input, '[name=q]')).toBe(true)
    expect(matchesSelector(input, '[data-tour^="search"]')).toBe(true)
    expect(matchesSelector(input, '[data-tour$="box"]')).toBe(true)
    expect(matchesSelector(input, '[data-tour*="ch b"]')).toBe(true)
    expect(matchesSelector(input, '[data-tour~="box"]')).toBe(true)
    expect(matchesSelector(input, '[data-tour~="bo"]')).toBe(false)
    expect(matchesSelector(input, '[missing]')).toBe(false)
  })

  it('matches descendants, children and lists', () => {
    const { input } = tree()
    expect(matchesSelector(input, 'form input')).toBe(true)
    expect(matchesSelector(input, 'form > input')).toBe(false)
    expect(matchesSelector(input, 'form > label > input')).toBe(true)
    expect(matchesSelector(input, 'section input')).toBe(false)
    expect(matchesSelector(input, 'p, input')).toBe(true)
    expect(matchesSelector(input.ownerDocument.documentElement, 'body > html')).toBe(false)
  })

  it('matches the states views ask for', () => {
    const { document, input } = tree()
    const box = document.createElement('input')
    box.type = 'checkbox'
    expect(matchesSelector(box, ':checked')).toBe(false)
    box.checked = true
    expect(matchesSelector(box, 'input:checked')).toBe(true)
    const option = document.createElement('option')
    option.setAttribute('selected', '')
    expect(matchesSelector(option, ':checked')).toBe(true)
    input.disabled = true
    expect(matchesSelector(input, ':disabled')).toBe(true)
    expect(matchesSelector(input, ':not(.form)')).toBe(true)
    expect(matchesSelector(input, ':not(input)')).toBe(false)
    expect(matchesSelector(input, ':popover-open')).toBe(false)
    expect(matchesSelector(input, ':hover')).toBe(false)
    expect(matchesSelector(input, ':not(input')).toBe(true)
    expect(matchesSelector(document.createElement('p') as FakeElement, '')).toBe(false)
  })
})
