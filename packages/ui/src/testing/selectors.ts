import { type FakeElement, isPopoverOpen } from './fake-dom.ts'

/**
 * Whether an element matches a CSS selector, for the selectors tests and views use: tags, ids, classes,
 * attributes (`=`, `^=`, `$=`, `*=`, `~=`), `:checked`, `:disabled`, `:popover-open`, `:not(...)`, and the
 * descendant and child combinators, in comma-separated lists.
 */
export const matchesSelector = (element: FakeElement, selector: string): boolean =>
  splitTopLevel(selector, ',').some((one) => matchesComplex(element, parseComplex(one.trim())))

interface Compound {
  readonly tag: string | null
  readonly ids: ReadonlyArray<string>
  readonly classes: ReadonlyArray<string>
  readonly attributes: ReadonlyArray<{
    readonly name: string
    readonly operator: string
    readonly value: string
  }>
  readonly pseudos: ReadonlyArray<{ readonly name: string; readonly argument: string }>
}

interface Step {
  readonly compound: Compound
  readonly combinator: ' ' | '>' | null
}

const parseComplex = (selector: string): ReadonlyArray<Step> => {
  const steps: Step[] = []
  let rest = selector
  let combinator: ' ' | '>' | null = null
  while (rest !== '') {
    const [compound, after] = parseCompound(rest)
    steps.push({ compound, combinator })
    const gap = /^\s*(>)?\s*/.exec(after)!
    combinator = gap[1] === '>' ? '>' : ' '
    rest = after.slice(gap[0].length)
  }
  return steps
}

const parseCompound = (text: string): readonly [Compound, string] => {
  const tag = /^(\*|[a-zA-Z][\w-]*)/.exec(text)
  let rest = tag === null ? text : text.slice(tag[0].length)
  const ids: string[] = []
  const classes: string[] = []
  const attributes: Array<{ name: string; operator: string; value: string }> = []
  const pseudos: Array<{ name: string; argument: string }> = []
  for (;;) {
    const id = /^#([\w-]+)/.exec(rest)
    const className = /^\.([\w-]+)/.exec(rest)
    const attribute = /^\[\s*([\w-]+)\s*(?:([~^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]/.exec(rest)
    const pseudo = /^:([\w-]+)/.exec(rest)
    if (id !== null) ids.push(id[1]!)
    else if (className !== null) classes.push(className[1]!)
    else if (attribute !== null)
      attributes.push({
        name: attribute[1]!.toLowerCase(),
        operator: attribute[2] ?? '',
        value: attribute[3] ?? attribute[4] ?? attribute[5] ?? '',
      })
    else if (pseudo !== null) {
      const argument = rest[pseudo[0].length] === '(' ? balanced(rest.slice(pseudo[0].length)) : ''
      pseudos.push({ name: pseudo[1]!, argument: argument.slice(1, -1) })
      rest = rest.slice(pseudo[0].length + argument.length)
      continue
    } else break
    rest = rest.slice((id ?? className ?? attribute)![0].length)
  }
  const tagName = tag === null || tag[1] === '*' ? null : tag[1]!.toLowerCase()
  return [{ tag: tagName, ids, classes, attributes, pseudos }, rest]
}

const balanced = (text: string): string => {
  let depth = 0
  for (const [index, character] of [...text].entries()) {
    if (character === '(') depth++
    if (character === ')') depth--
    if (depth === 0) return text.slice(0, index + 1)
  }
  return text
}

const matchesComplex = (element: FakeElement, steps: ReadonlyArray<Step>): boolean => {
  const last = steps.at(-1)
  if (last === undefined || !matchesCompound(element, last.compound)) return false
  if (steps.length === 1) return true
  const earlier = steps.slice(0, -1)
  if (last.combinator === '>')
    return element.parentElement !== null && matchesComplex(element.parentElement, earlier)
  for (let ancestor = element.parentElement; ancestor !== null; ancestor = ancestor.parentElement)
    if (matchesComplex(ancestor, earlier)) return true
  return false
}

const matchesCompound = (element: FakeElement, compound: Compound): boolean =>
  (compound.tag === null || element.localName.toLowerCase() === compound.tag) &&
  compound.ids.every((id) => element.id === id) &&
  compound.classes.every((name) => element.classList.contains(name)) &&
  compound.attributes.every((attribute) =>
    matchesAttribute(element.getAttribute(attribute.name), attribute),
  ) &&
  compound.pseudos.every((pseudo) => matchesPseudo(element, pseudo.name, pseudo.argument))

const matchesAttribute = (
  actual: string | null,
  wanted: { readonly operator: string; readonly value: string },
) => {
  if (actual === null) return false
  switch (wanted.operator) {
    case '=':
      return actual === wanted.value
    case '^=':
      return actual.startsWith(wanted.value)
    case '$=':
      return actual.endsWith(wanted.value)
    case '*=':
      return actual.includes(wanted.value)
    case '~=':
      return actual.split(/\s+/).includes(wanted.value)
    default:
      return true
  }
}

const matchesPseudo = (element: FakeElement, name: string, argument: string): boolean => {
  switch (name) {
    case 'checked':
      return element.localName === 'option' ? element.selected : element.checked === true
    case 'disabled':
      return element.disabled
    case 'popover-open':
      return isPopoverOpen(element)
    case 'not':
      return !matchesSelector(element, argument)
    default:
      return false
  }
}

const splitTopLevel = (text: string, separator: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (const [index, character] of [...text].entries()) {
    if (character === '(' || character === '[') depth++
    if (character === ')' || character === ']') depth--
    if (character === separator && depth === 0) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}
