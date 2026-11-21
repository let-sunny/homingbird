import { textSegments } from './linkify.ts'

export type Child = Node | string | number | null | undefined | false | ReadonlyArray<Child>

export interface Properties {
  readonly class?: string
  readonly on?: { readonly [Type in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[Type]) => void }
  readonly data?: Readonly<Record<string, string>>
  readonly [attribute: string]: unknown
}

export const h = <Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  properties: Properties = {},
  ...children: ReadonlyArray<Child>
): HTMLElementTagNameMap[Tag] => {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(properties)) applyProperty(element, name, value)
  append(element, children)
  return element
}

/** An SVG element with its attributes and children, as `h` builds an HTML one. */
export const svg = (
  tag: string,
  attributes: Readonly<Record<string, string | number>>,
  ...children: ReadonlyArray<Element>
): SVGElement => {
  const element = document.createElementNS(SVG_NAMESPACE, tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value))
  element.append(...children)
  return element
}

export const append = (parent: Node, children: Child): void => {
  if (children === null || children === undefined || children === false) return
  if (isChildList(children)) {
    for (const child of children) append(parent, child)
    return
  }
  parent.appendChild(typeof children === 'object' ? children : document.createTextNode(String(children)))
}

export const replaceChildren = (parent: Element, ...children: ReadonlyArray<Child>): void => {
  const fragment = document.createDocumentFragment()
  append(fragment, children)
  parent.replaceChildren(fragment)
}

export const linkedText = (text: string): Node[] =>
  Array.from(textSegments(text), (segment) =>
    segment.type === 'text'
      ? document.createTextNode(segment.value)
      : segment.kind === 'mail'
        ? h('a', { href: segment.href }, segment.value)
        : h('a', { href: segment.href, rel: 'noopener noreferrer', target: '_blank' }, segment.value),
  )

const isChildList = (children: Child): children is ReadonlyArray<Child> => Array.isArray(children)

const applyProperty = (element: HTMLElement, name: string, value: unknown): void => {
  if (value === null || value === undefined || value === false) return
  if (name === 'class') element.className = String(value)
  else if (name === 'on')
    for (const [type, listener] of Object.entries(value as Record<string, EventListener>))
      element.addEventListener(type, listener)
  else if (name === 'data') Object.assign(element.dataset, value)
  else if (name === 'value' && 'value' in element) (element as HTMLInputElement).value = String(value)
  else if (name === 'checked' && 'checked' in element) (element as HTMLInputElement).checked = value === true
  else element.setAttribute(name, value === true ? '' : String(value))
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
