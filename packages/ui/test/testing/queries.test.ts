import { beforeEach, describe, expect, it } from 'vitest'
import { type FakeDocument, type FakeElement, fakeDocument } from '../../src/testing/fake-dom.ts'
import {
  accessibleName,
  allByRole,
  allByText,
  getByRole,
  getByTestId,
  getByText,
  queryByRole,
  queryByText,
  roleOf,
  textOf,
} from '../../src/testing/queries.ts'

let document: FakeDocument
const make = (
  tag: string,
  attributes: Record<string, string> = {},
  ...children: Array<FakeElement | string>
) => {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  element.append(...children)
  return element
}

beforeEach(() => {
  document = fakeDocument()
})

describe('roles', () => {
  it('takes a given role first, then the one its tag implies', () => {
    const roles = [
      make('span', { role: 'switch status' }),
      make('button'),
      make('a', { href: '#/' }),
      make('a'),
      make('input'),
      make('input', { type: 'checkbox' }),
      make('input', { type: 'radio' }),
      make('input', { type: 'search' }),
      make('input', { type: 'number' }),
      make('textarea'),
      make('select'),
      make('option'),
      make('ul'),
      make('ol'),
      make('li'),
      ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((tag) => make(tag)),
      make('nav'),
      make('main'),
      make('dialog'),
      make('fieldset'),
      make('form'),
      make('table'),
      make('tr'),
      make('td'),
      make('th'),
      make('th', { scope: 'row' }),
      make('img', { alt: '' }),
      make('img', { alt: 'Logo' }),
      make('article'),
      make('section'),
      make('section', { 'aria-label': 'Basis' }),
      make('details'),
      make('summary'),
      make('div'),
    ].map(roleOf)
    expect(roles).toEqual([
      'switch',
      'button',
      'link',
      null,
      'textbox',
      'checkbox',
      'radio',
      'searchbox',
      'spinbutton',
      'textbox',
      'combobox',
      'option',
      'list',
      'list',
      'listitem',
      ...Array(6).fill('heading'),
      'navigation',
      'main',
      'dialog',
      'group',
      'form',
      'table',
      'row',
      'cell',
      'columnheader',
      'rowheader',
      'presentation',
      'img',
      'article',
      null,
      'region',
      'group',
      'button',
      null,
    ])
  })
})

describe('accessibleName', () => {
  it('reads aria-labelledby, aria-label, alt, a label, content and title, in that order', () => {
    const heading = make('h2', { id: 'title' }, 'Members')
    document.body.appendChild(heading)
    const labelled = make('section', { 'aria-labelledby': 'title missing' })
    document.body.appendChild(labelled)
    expect(accessibleName(labelled)).toBe('Members')
    expect(accessibleName(make('button', { 'aria-label': ' Close ' }, '✕'))).toBe('Close')
    expect(accessibleName(make('button', { 'aria-label': '' }, 'Send'))).toBe('Send')
    expect(accessibleName(make('img', { alt: 'Logo' }))).toBe('Logo')
    expect(accessibleName(make('img', { title: 'Mark' }))).toBe('Mark')
    expect(accessibleName(make('img'))).toBe('')
    expect(accessibleName(make('button', { title: 'Hint' }))).toBe('Hint')
    expect(accessibleName(make('div', { title: 'Plain' }, 'Text'))).toBe('Plain')
    expect(accessibleName(make('div'))).toBe('')
    expect(accessibleName(make('fieldset', {}, make('legend', {}, 'Appearance'), 'choices'))).toBe(
      'Appearance',
    )
    expect(accessibleName(make('table', {}, make('caption', {}, 'Figures')))).toBe('Figures')
    expect(accessibleName(make('fieldset', { title: 'Untitled' }))).toBe('Untitled')
  })

  it('names a control by its label, wrapping or by for, else by title or placeholder', () => {
    const wrapped = make('input')
    make('label', {}, make('span', {}, 'Name'), wrapped, make('small', {}, 'hint'))
    expect(accessibleName(wrapped)).toBe('Name hint')
    const select = make('select', {}, make('option', {}, 'Any'))
    make('label', {}, 'Channel', select)
    expect(accessibleName(select)).toBe('Channel')
    const byFor = make('input', { id: 'code' })
    document.body.append(make('label', { for: 'code' }, 'Code'), byFor)
    expect(accessibleName(byFor)).toBe('Code')
    expect(accessibleName(make('input', { title: 'Search' }))).toBe('Search')
    expect(accessibleName(make('textarea', { placeholder: 'Write' }))).toBe('Write')
    expect(accessibleName(make('textarea'))).toBe('')
  })
})

describe('finding elements', () => {
  it('finds by role and name, leaving hidden ones out unless asked', () => {
    const root = make(
      'div',
      {},
      make('button', {}, 'Send'),
      make('button', { hidden: '' }, 'Send'),
      make('span', { 'aria-hidden': 'true' }, make('button', {}, 'Send')),
      make('button', {}, 'Discard'),
    )
    expect(getByRole(root, 'button', { name: 'Send' })).toBe(root.firstChild)
    expect(allByRole(root, 'button')).toHaveLength(2)
    expect(allByRole(root, 'button', { hidden: true })).toHaveLength(4)
    expect(allByRole(root, 'button', { name: /^D/ })).toHaveLength(1)
    expect(queryByRole(root, 'link')).toBeNull()
    expect(() => getByRole(root, 'button')).toThrow('expected one element with role "button", found 2')
    expect(() => getByRole(root, 'link', { name: 'Home' })).toThrow('role "link" named Home')
    expect(allByRole(make('button', { hidden: '' }), 'button')).toEqual([])
    const menu = make('div', { popover: 'auto' }, make('button', {}, 'Delete'))
    const dialog = make('dialog', {}, make('button', {}, 'Save'))
    const details = make('details', {}, make('summary', {}, 'More'), make('button', {}, 'Inside'))
    const page = make('div', {}, menu, dialog, details)
    document.body.append(page)
    expect(allByRole(page, 'button').map((button) => button.textContent)).toEqual(['More'])
    menu.showPopover()
    dialog.showModal()
    details.open = true
    expect(allByRole(page, 'button').map((button) => button.textContent)).toEqual([
      'Delete',
      'Save',
      'More',
      'Inside',
    ])
    expect(allByRole(make('button'), 'button')).toHaveLength(1)
  })

  it('finds the innermost element showing a text', () => {
    const root = make('div', {}, make('p', {}, make('strong', {}, 'Ana')), make('p', {}, 'Ben  Ito'))
    expect(getByText(root, 'Ana').localName).toBe('strong')
    expect(getByText(root, 'Ben Ito').localName).toBe('p')
    expect(allByText(root, /Ana|Ben/)).toHaveLength(2)
    expect(queryByText(root, 'Cy')).toBeNull()
    expect(() => getByText(root, 'Cy')).toThrow()
  })

  it('finds by test id and reads text with spaces folded', () => {
    const root = make('div', {}, make('span', { 'data-testid': 'count' }, ' 3 \n new '))
    expect(textOf(getByTestId(root, 'count'))).toBe('3 new')
  })
})
