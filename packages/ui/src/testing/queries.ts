import { type FakeElement, type FakeNode, isPopoverOpen } from './fake-dom.ts'

/**
 * Finds what a person would find: elements by their role and accessible name, by the text they show,
 * or by a test id. Hidden elements (`hidden`, `aria-hidden`) are left out, as assistive technology
 * leaves them out. `get…` expects exactly one; `query…` returns null; `all…` returns every match.
 */
export const getByRole = (root: unknown, role: string, options: NameOptions = {}): HTMLElement =>
  exactlyOne(allByRole(root, role, options), `role "${role}"${describeName(options)}`)

export const queryByRole = (root: unknown, role: string, options: NameOptions = {}): HTMLElement | null =>
  allByRole(root, role, options)[0] ?? null

export const allByRole = (root: unknown, role: string, options: NameOptions = {}): HTMLElement[] =>
  shownElements(asNode(root), options.hidden === true)
    .filter((element) => roleOf(element) === role)
    .filter((element) => options.name === undefined || matchesText(accessibleName(element), options.name))
    .map(asHtml)

export const getByText = (root: unknown, text: string | RegExp): HTMLElement =>
  exactlyOne(allByText(root, text), `text ${String(text)}`)

export const queryByText = (root: unknown, text: string | RegExp): HTMLElement | null =>
  allByText(root, text)[0] ?? null

/** The innermost elements whose text matches: a match inside a match counts once, as the inner one. */
export const allByText = (root: unknown, text: string | RegExp): HTMLElement[] => {
  const matching = shownElements(asNode(root), false).filter((element) => matchesText(textOf(element), text))
  return matching
    .filter((element) => !matching.some((other) => other !== element && element.contains(other)))
    .map(asHtml)
}

export const getByTestId = (root: unknown, id: string): HTMLElement =>
  exactlyOne(
    shownElements(asNode(root), true).filter((element) => element.getAttribute('data-testid') === id),
    `test id "${id}"`,
  )

/** The text a node shows, with runs of white space as one space. */
export const textOf = (node: unknown): string => normalized(asNode(node).textContent)

/** The role an element has, given or implied by its tag. */
export const roleOf = (element: unknown): string | null => {
  const node = asNode(element) as FakeElement
  const given = node.getAttribute('role')?.trim().split(/\s+/)[0]
  if (given !== undefined && given !== '') return given
  return implicitRole(node)
}

/** The name assistive technology announces for an element. */
export const accessibleName = (element: unknown): string => {
  const node = asNode(element) as FakeElement
  const labelledBy = node.getAttribute('aria-labelledby')
  if (labelledBy !== null)
    return normalized(
      labelledBy
        .split(/\s+/)
        .map((id) => node.ownerDocument.getElementById(id)?.textContent ?? '')
        .join(' '),
    )
  const label = node.getAttribute('aria-label')
  if (label !== null && label.trim() !== '') return normalized(label)
  if (node.localName === 'img')
    return normalized(node.getAttribute('alt') ?? node.getAttribute('title') ?? '')
  const caption = CAPTIONS[node.localName]
  const captioned =
    caption === undefined ? undefined : node.children.find((child) => child.localName === caption)
  if (captioned !== undefined) return textOf(captioned)
  if (FORM_CONTROLS.has(node.localName)) return controlLabel(node)
  if (NAMED_BY_CONTENT.has(roleOf(node) ?? ''))
    return textOf(node) || normalized(node.getAttribute('title') ?? '')
  return normalized(node.getAttribute('title') ?? '')
}

export interface NameOptions {
  readonly name?: string | RegExp
  readonly hidden?: boolean
}

const FORM_CONTROLS = new Set(['input', 'select', 'textarea'])

/** The child element that names a group, a figure or a table. */
const CAPTIONS: Readonly<Record<string, string>> = {
  fieldset: 'legend',
  figure: 'figcaption',
  table: 'caption',
}

const NAMED_BY_CONTENT = new Set([
  'button',
  'link',
  'heading',
  'switch',
  'checkbox',
  'radio',
  'option',
  'tab',
  'menuitem',
  'cell',
  'columnheader',
  'rowheader',
  'listitem',
])

const implicitRole = (element: FakeElement): string | null => {
  switch (element.localName) {
    case 'button':
      return 'button'
    case 'a':
      return element.hasAttribute('href') ? 'link' : null
    case 'input':
      return INPUT_ROLES[element.type] ?? 'textbox'
    case 'textarea':
      return 'textbox'
    case 'select':
      return 'combobox'
    case 'option':
      return 'option'
    case 'ul':
    case 'ol':
      return 'list'
    case 'li':
      return 'listitem'
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading'
    case 'nav':
      return 'navigation'
    case 'main':
      return 'main'
    case 'dialog':
      return 'dialog'
    case 'fieldset':
      return 'group'
    case 'form':
      return 'form'
    case 'table':
      return 'table'
    case 'tr':
      return 'row'
    case 'td':
      return 'cell'
    case 'th':
      return element.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader'
    case 'img':
      return element.getAttribute('alt') === '' ? 'presentation' : 'img'
    case 'article':
      return 'article'
    case 'section':
      return element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby') ? 'region' : null
    case 'details':
      return 'group'
    case 'summary':
      return 'button'
    default:
      return null
  }
}

const INPUT_ROLES: Readonly<Record<string, string>> = {
  checkbox: 'checkbox',
  radio: 'radio',
  search: 'searchbox',
  number: 'spinbutton',
  submit: 'button',
  button: 'button',
  color: 'textbox',
}

const controlLabel = (control: FakeElement): string => {
  const wrapping = control.closest('label')
  const byFor = control.id === '' ? null : control.ownerDocument.querySelector(`label[for="${control.id}"]`)
  const label = wrapping ?? byFor
  if (label !== null) return normalized(textWithout(label, control))
  return normalized(control.getAttribute('title') ?? control.getAttribute('placeholder') ?? '')
}

const textWithout = (node: FakeNode, left: FakeNode): string =>
  node === left
    ? ''
    : node.nodeType === 3
      ? node.textContent
      : node.childNodes
          .filter((child) => !(child.nodeType === 1 && (child as FakeElement).localName === 'select'))
          .map((child) => textWithout(child, left))
          .join(' ')

const shownElements = (root: FakeNode, includeHidden: boolean): FakeElement[] => {
  const found: FakeElement[] = []
  const visit = (node: FakeNode): void => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue
      const element = child as FakeElement
      if (!includeHidden && isHidden(element)) continue
      found.push(element)
      visit(element)
    }
  }
  if (root.nodeType === 1 && (includeHidden || !isHidden(root as FakeElement)))
    found.push(root as FakeElement)
  visit(root)
  return found
}

/** Hidden as a browser hides it: by attribute, as a closed popover or dialog, or inside closed details. */
const isHidden = (element: FakeElement): boolean =>
  element.hidden ||
  element.getAttribute('aria-hidden') === 'true' ||
  (element.hasAttribute('popover') && !isPopoverOpen(element)) ||
  (element.localName === 'dialog' && !element.open) ||
  (element.parentElement?.localName === 'details' &&
    !element.parentElement.open &&
    element.localName !== 'summary')

const matchesText = (actual: string, wanted: string | RegExp): boolean =>
  typeof wanted === 'string' ? actual === normalized(wanted) : wanted.test(actual)

const normalized = (text: string): string => text.replace(/\s+/g, ' ').trim()

const describeName = (options: NameOptions): string =>
  options.name === undefined ? '' : ` named ${String(options.name)}`

const exactlyOne = (found: ReadonlyArray<FakeElement | HTMLElement>, what: string): HTMLElement => {
  if (found.length !== 1) throw new Error(`expected one element with ${what}, found ${found.length}`)
  return asHtml(found[0]!)
}

const asNode = (value: unknown): FakeNode => value as FakeNode

const asHtml = (element: FakeElement | HTMLElement): HTMLElement => element as HTMLElement
