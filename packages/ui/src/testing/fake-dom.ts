import { matchesSelector } from './selectors.ts'

/**
 * A document small enough to read in one sitting: elements, text, attributes, events, focus, popovers
 * and dialogs, as far as the views use them. It stands in for the browser's document in unit tests.
 */
export const installFakeDom = (options: FakeDomOptions = {}): FakeDocument => {
  const previous = (globalThis as { document?: unknown }).document
  const document = fakeDocument(options)
  Object.assign(globalThis, { document })
  installed.push({ document, previous })
  return document
}

/** Puts back whatever `document` was before the latest `installFakeDom`. */
export const uninstallFakeDom = (): void => {
  const last = installed.pop()
  if (last === undefined) return
  Object.assign(globalThis, { document: last.previous })
}

/**
 * What the fake browser lacks: `popovers: false` models one without the Popover API, `invokers: false`
 * one that does not run `command`/`commandfor` buttons by itself.
 */
export interface FakeDomOptions {
  readonly popovers?: boolean
  readonly invokers?: boolean
}

/** Whether a popover element is shown; what `:popover-open` matches. */
export const isPopoverOpen = (element: FakeElement): boolean => popoverState.get(element)?.() ?? false

export interface FakeEventInit {
  readonly bubbles?: boolean
  readonly key?: string
  readonly shiftKey?: boolean
  readonly isComposing?: boolean
  readonly isTrusted?: boolean
  readonly pointerType?: string
  readonly clientX?: number
  readonly clientY?: number
  readonly newState?: 'open' | 'closed'
  readonly relatedTarget?: FakeNode | null
}

export interface FakeEvent extends Required<Omit<FakeEventInit, 'relatedTarget'>> {
  readonly type: string
  readonly relatedTarget: FakeNode | null
  readonly target: FakeNode | null
  readonly currentTarget: FakeNode | null
  readonly defaultPrevented: boolean
  readonly preventDefault: () => void
  readonly stopPropagation: () => void
}

export const fakeEvent = (type: string, init: FakeEventInit = {}): FakeEvent => {
  const state = {
    prevented: false,
    stopped: false,
    target: null as FakeNode | null,
    current: null as FakeNode | null,
  }
  const event = {
    type,
    bubbles: init.bubbles ?? BUBBLING.has(type),
    key: init.key ?? '',
    shiftKey: init.shiftKey ?? false,
    isComposing: init.isComposing ?? false,
    isTrusted: init.isTrusted ?? true,
    pointerType: init.pointerType ?? 'mouse',
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    newState: init.newState ?? 'closed',
    relatedTarget: init.relatedTarget ?? null,
    get target() {
      return state.target
    },
    get currentTarget() {
      return state.current
    },
    get defaultPrevented() {
      return state.prevented
    },
    preventDefault: () => {
      state.prevented = true
    },
    stopPropagation: () => {
      state.stopped = true
    },
  }
  dispatchState.set(event, state)
  return event
}

export type Listener = (event: FakeEvent) => void

export interface FakeNode {
  readonly nodeType: number
  readonly nodeName: string
  readonly ownerDocument: FakeDocument
  readonly childNodes: ReadonlyArray<FakeNode>
  readonly parentNode: FakeNode | null
  readonly parentElement: FakeElement | null
  readonly firstChild: FakeNode | null
  readonly lastChild: FakeNode | null
  readonly nextSibling: FakeNode | null
  readonly previousSibling: FakeNode | null
  readonly isConnected: boolean
  textContent: string
  readonly appendChild: (child: FakeNode) => FakeNode
  readonly insertBefore: (child: FakeNode, before: FakeNode | null) => FakeNode
  readonly removeChild: (child: FakeNode) => FakeNode
  readonly append: (...children: ReadonlyArray<FakeNode | string>) => void
  readonly prepend: (...children: ReadonlyArray<FakeNode | string>) => void
  readonly replaceChildren: (...children: ReadonlyArray<FakeNode | string>) => void
  readonly replaceWith: (...nodes: ReadonlyArray<FakeNode | string>) => void
  readonly remove: () => void
  readonly contains: (other: FakeNode | null) => boolean
  readonly addEventListener: (
    type: string,
    listener: Listener,
    options?: { readonly once?: boolean; readonly capture?: boolean } | boolean,
  ) => void
  readonly removeEventListener: (
    type: string,
    listener: Listener,
    options?: { readonly capture?: boolean } | boolean,
  ) => void
  readonly dispatchEvent: (event: FakeEvent) => boolean
}

export interface FakeElement extends FakeNode {
  readonly tagName: string
  readonly localName: string
  readonly namespaceURI: string
  readonly children: ReadonlyArray<FakeElement>
  readonly attributes: ReadonlyArray<{ readonly name: string; readonly value: string }>
  readonly dataset: Record<string, string | undefined>
  readonly style: FakeStyle
  readonly classList: FakeClassList
  id: string
  className: string
  hidden: boolean
  disabled: boolean
  required: boolean
  open: boolean
  name: string
  type: string
  rows: number
  maxLength: number
  value: string
  checked: boolean
  selected: boolean
  readonly options: ReadonlyArray<FakeElement>
  readonly getAttribute: (name: string) => string | null
  readonly setAttribute: (name: string, value: string) => void
  readonly removeAttribute: (name: string) => void
  readonly hasAttribute: (name: string) => boolean
  readonly toggleAttribute: (name: string, force?: boolean) => boolean
  readonly matches: (selector: string) => boolean
  readonly closest: (selector: string) => FakeElement | null
  readonly querySelector: (selector: string) => FakeElement | null
  readonly querySelectorAll: (selector: string) => ReadonlyArray<FakeElement>
  readonly focus: (options?: unknown) => void
  readonly blur: () => void
  readonly click: () => void
  readonly showPopover: () => void
  readonly hidePopover: () => void
  readonly togglePopover: () => boolean
  readonly showModal: () => void
  readonly show: () => void
  readonly close: () => void
  readonly requestSubmit: () => void
  readonly reportValidity: () => boolean
  readonly checkVisibility: () => boolean
  readonly scrollIntoView: (options?: unknown) => void
  readonly scrollTo: (options?: unknown) => void
  readonly getContext: (kind: string) => null
}

export interface FakeStyle {
  readonly setProperty: (name: string, value: string) => void
  readonly getPropertyValue: (name: string) => string
  readonly removeProperty: (name: string) => string
}

export interface FakeClassList {
  readonly add: (...names: ReadonlyArray<string>) => void
  readonly remove: (...names: ReadonlyArray<string>) => void
  readonly toggle: (name: string, force?: boolean) => boolean
  readonly contains: (name: string) => boolean
}

export interface FakeDocument extends FakeNode {
  readonly documentElement: FakeElement
  readonly head: FakeElement
  readonly body: FakeElement
  readonly activeElement: FakeElement
  visibilityState: 'visible' | 'hidden'
  title: string
  readonly createElement: (tag: string) => FakeElement
  readonly createElementNS: (namespace: string, tag: string) => FakeElement
  readonly createTextNode: (text: string) => FakeNode
  readonly createDocumentFragment: () => FakeNode
  readonly getElementById: (id: string) => FakeElement | null
  readonly querySelector: (selector: string) => FakeElement | null
  readonly querySelectorAll: (selector: string) => ReadonlyArray<FakeElement>
}

export const fakeDocument = (options: FakeDomOptions = {}): FakeDocument => {
  const focus = { active: null as FakeElement | null }
  const document = baseNode(9, '#document', null) as unknown as FakeDocument & Internal
  const root = makeElement(document, 'html', HTML)
  const head = makeElement(document, 'head', HTML)
  const body = makeElement(document, 'body', HTML)
  root.append(head, body)
  document.appendChild(root)
  Object.defineProperties(document, {
    documentElement: { value: root },
    head: { value: head },
    body: { value: body },
    activeElement: { get: () => (focus.active?.isConnected === true ? focus.active : body) },
    visibilityState: { value: 'visible', writable: true },
    title: { value: '', writable: true },
    createElement: { value: (tag: string) => makeElement(document, tag.toLowerCase(), HTML) },
    createElementNS: { value: (namespace: string, tag: string) => makeElement(document, tag, namespace) },
    createTextNode: { value: (text: string) => makeText(document, text) },
    createDocumentFragment: { value: () => baseNode(11, '#document-fragment', document) },
    getElementById: {
      value: (id: string) => descendants(document).find((element) => element.id === id) ?? null,
    },
    querySelector: {
      value: (selector: string) =>
        descendants(document).find((element) => matchesSelector(element, selector)) ?? null,
    },
    querySelectorAll: {
      value: (selector: string) =>
        descendants(document).filter((element) => matchesSelector(element, selector)),
    },
  })
  focusOf.set(document, focus)
  optionsOf.set(document, options)
  return document
}

interface Internal {
  readonly nodes: FakeNode[]
  parent: FakeNode | null
}

const HTML = 'http://www.w3.org/1999/xhtml'

const BUBBLING = new Set([
  'click',
  'input',
  'change',
  'submit',
  'keydown',
  'keyup',
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointercancel',
  'contextmenu',
  'focusin',
  'focusout',
  'wheel',
  'touchstart',
])

const installed: Array<{ readonly document: FakeDocument; readonly previous: unknown }> = []

const dispatchState = new WeakMap<
  object,
  { prevented: boolean; stopped: boolean; target: FakeNode | null; current: FakeNode | null }
>()

const focusOf = new WeakMap<FakeNode, { active: FakeElement | null }>()

const optionsOf = new WeakMap<FakeNode, FakeDomOptions>()

const listenersOf = new WeakMap<
  FakeNode,
  Map<string, Array<{ listener: Listener; once: boolean; capture: boolean }>>
>()

const baseNode = (nodeType: number, nodeName: string, owner: FakeDocument | null): FakeNode & Internal => {
  const node = {
    nodes: [] as FakeNode[],
    parent: null as FakeNode | null,
  } as FakeNode & Internal
  const internal = (other: FakeNode): FakeNode & Internal => other as FakeNode & Internal
  const detach = (child: FakeNode): void => {
    const parent = internal(child).parent
    if (parent === null) return
    const siblings = internal(parent).nodes
    siblings.splice(siblings.indexOf(child), 1)
    internal(child).parent = null
  }
  const adopt = (child: FakeNode, at: number): void => {
    if (child.nodeType === 11) {
      const moved = [...internal(child).nodes]
      for (const each of moved) detach(each)
      node.nodes.splice(at, 0, ...moved)
      for (const each of moved) internal(each).parent = node
      return
    }
    detach(child)
    node.nodes.splice(Math.min(at, node.nodes.length), 0, child)
    internal(child).parent = node
  }
  const toNodes = (children: ReadonlyArray<FakeNode | string>): FakeNode[] =>
    children.map((child) => (typeof child === 'string' ? makeText(node.ownerDocument, child) : child))
  Object.defineProperties(node, {
    nodeType: { value: nodeType },
    nodeName: { value: nodeName },
    ownerDocument: { get: () => owner ?? node },
    childNodes: { get: () => [...node.nodes] },
    parentNode: { get: () => node.parent },
    parentElement: { get: () => (node.parent?.nodeType === 1 ? node.parent : null) },
    firstChild: { get: () => node.nodes[0] ?? null },
    lastChild: { get: () => node.nodes.at(-1) ?? null },
    nextSibling: { get: () => siblingAt(node, 1) },
    previousSibling: { get: () => siblingAt(node, -1) },
    isConnected: { get: () => nodeType === 9 || node.parent?.isConnected === true },
    textContent: {
      get: () => node.nodes.map((child) => (child.nodeType === 8 ? '' : child.textContent)).join(''),
      set: (text: string) => {
        for (const child of [...node.nodes]) detach(child)
        if (text !== '') adopt(makeText(node.ownerDocument, text), 0)
      },
      configurable: true,
    },
    appendChild: {
      value: (child: FakeNode) => {
        adopt(child, node.nodes.length)
        return child
      },
    },
    insertBefore: {
      value: (child: FakeNode, before: FakeNode | null) => {
        if (child === before) return child
        detach(child)
        adopt(child, before === null ? node.nodes.length : node.nodes.indexOf(before))
        return child
      },
    },
    removeChild: {
      value: (child: FakeNode) => {
        detach(child)
        return child
      },
    },
    append: {
      value: (...children: ReadonlyArray<FakeNode | string>) => {
        for (const child of toNodes(children)) adopt(child, node.nodes.length)
      },
    },
    prepend: {
      value: (...children: ReadonlyArray<FakeNode | string>) => {
        for (const [index, child] of toNodes(children).entries()) adopt(child, index)
      },
    },
    replaceChildren: {
      value: (...children: ReadonlyArray<FakeNode | string>) => {
        for (const child of [...node.nodes]) detach(child)
        for (const child of toNodes(children)) adopt(child, node.nodes.length)
      },
    },
    replaceWith: {
      value: (...replacements: ReadonlyArray<FakeNode | string>) => {
        const parent = node.parent
        if (parent === null) return
        const nodes = toNodes(replacements)
        for (const each of nodes) parent.insertBefore(each, node)
        detach(node)
      },
    },
    remove: { value: () => detach(node) },
    contains: {
      value: (other: FakeNode | null) => {
        for (let current = other; current !== null; current = current.parentNode)
          if (current === node) return true
        return false
      },
    },
    addEventListener: {
      value: (
        type: string,
        listener: Listener,
        options?: { readonly once?: boolean; readonly capture?: boolean } | boolean,
      ) => {
        const all = listenersOf.get(node) ?? new Map()
        listenersOf.set(node, all)
        const list = all.get(type) ?? []
        const capture = isCapture(options)
        if (list.some((entry: Entry) => entry.listener === listener && entry.capture === capture)) return
        list.push({ listener, once: typeof options === 'object' && options.once === true, capture })
        all.set(type, list)
      },
    },
    removeEventListener: {
      value: (type: string, listener: Listener, options?: { readonly capture?: boolean } | boolean) => {
        const list = listenersOf.get(node)?.get(type)
        if (list === undefined) return
        const capture = isCapture(options)
        listenersOf.get(node)!.set(
          type,
          list.filter((entry) => entry.listener !== listener || entry.capture !== capture),
        )
      },
    },
    dispatchEvent: { value: (event: FakeEvent) => dispatch(node, event) },
  })
  return node
}

type Entry = { readonly listener: Listener; readonly once: boolean; readonly capture: boolean }

const isCapture = (options: { readonly capture?: boolean } | boolean | undefined): boolean =>
  typeof options === 'boolean' ? options : options?.capture === true

const siblingAt = (node: FakeNode & Internal, offset: number): FakeNode | null => {
  const parent = node.parent as (FakeNode & Internal) | null
  if (parent === null) return null
  return parent.nodes[parent.nodes.indexOf(node) + offset] ?? null
}

const dispatch = (target: FakeNode, event: FakeEvent): boolean => {
  const state = dispatchState.get(event)!
  state.target = target
  const toggles = toggledBy(target, event)
  const before = toggles?.checked ?? false
  if (toggles !== null) toggles.checked = toggles.type === 'radio' ? true : !before
  const path: FakeNode[] = []
  for (let current: FakeNode | null = target; current !== null; current = current.parentNode)
    path.push(current)
  const phases: ReadonlyArray<readonly [FakeNode, boolean]> = [
    ...path.toReversed().map((current) => [current, true] as const),
    ...(event.bubbles ? path : [target]).map((current) => [current, false] as const),
  ]
  for (const [current, capture] of phases) {
    state.current = current
    const list = listenersOf.get(current)?.get(event.type) ?? []
    for (const entry of list.filter((listed) => listed.capture === capture)) {
      if (entry.once) current.removeEventListener(event.type, entry.listener, { capture })
      entry.listener(event)
    }
    if (state.stopped) break
  }
  state.current = null
  if (toggles !== null && state.prevented) toggles.checked = before
  if (toggles !== null && !state.prevented && toggles.checked !== before) {
    toggles.dispatchEvent(fakeEvent('input'))
    toggles.dispatchEvent(fakeEvent('change'))
  }
  if (!state.prevented) defaultAction(target, event)
  return !state.prevented
}

const toggledBy = (target: FakeNode, event: FakeEvent): FakeElement | null => {
  if (event.type !== 'click' || target.nodeType !== 1) return null
  const element = target as FakeElement
  return element.localName === 'input' &&
    (element.type === 'checkbox' || element.type === 'radio') &&
    !element.disabled
    ? element
    : null
}

const defaultAction = (target: FakeNode, event: FakeEvent): void => {
  if (event.type !== 'click' || target.nodeType !== 1) return
  const element = target as FakeElement
  const button = element.closest('button')
  if (button !== null && !button.disabled) {
    pressButton(button)
    return
  }
  const summary = element.closest('summary')
  const details = summary?.parentElement
  if (details?.localName === 'details') details.open = !details.open
}

const pressButton = (button: FakeElement): void => {
  const document = button.ownerDocument
  const popover = button.getAttribute('popovertarget')
  if (popover !== null) document.getElementById(popover)?.togglePopover?.()
  const commandFor = optionsOf.get(document)?.invokers === false ? null : button.getAttribute('commandfor')
  const target = commandFor === null ? null : document.getElementById(commandFor)
  if (target !== null) perform(target, button.getAttribute('command') ?? '')
  if ((button.getAttribute('type') ?? 'submit') === 'submit') button.closest('form')?.requestSubmit()
}

const perform = (target: FakeElement, command: string): void => {
  if (command === 'show-modal' && !target.open) target.showModal()
  else if (command === 'close' && target.open) target.close()
  else if (command === 'toggle-popover') target.togglePopover?.()
  else if (command === 'show-popover') target.showPopover?.()
  else if (command === 'hide-popover') target.hidePopover?.()
}

const makeText = (owner: FakeDocument, text: string): FakeNode => {
  const node = baseNode(3, '#text', owner)
  let data = text
  Object.defineProperty(node, 'textContent', {
    get: () => data,
    set: (value: string) => {
      data = value
    },
  })
  return node
}

const VALUE_TAGS = new Set(['input', 'textarea', 'select', 'option', 'button'])

const BOOLEAN_ATTRIBUTES = ['hidden', 'disabled', 'required'] as const

const makeElement = (owner: FakeDocument, localName: string, namespaceURI: string): FakeElement => {
  const element = baseNode(1, localName.toUpperCase(), owner) as unknown as FakeElement & Internal
  const attributes = new Map<string, string>()
  const styles = new Map<string, string>()
  const dirty = {
    value: null as string | null,
    checked: null as boolean | null,
    selected: null as boolean | null,
  }
  const popover = { open: false }
  const focusState = (): { active: FakeElement | null } => focusOf.get(owner)!
  const valueAtFocus = { value: null as string | null }
  const setAttribute = (name: string, value: string): void => {
    attributes.set(name.toLowerCase(), String(value))
  }
  const removeAttribute = (name: string): void => {
    attributes.delete(name.toLowerCase())
  }
  const booleanAttribute = (name: string) => ({
    get: () => attributes.has(name),
    set: (on: boolean) => (on ? setAttribute(name, '') : removeAttribute(name)),
  })
  const classes = (): string[] => (attributes.get('class') ?? '').split(/\s+/).filter((name) => name !== '')
  const writeClasses = (names: ReadonlyArray<string>): void =>
    setAttribute('class', [...new Set(names)].join(' '))
  const options = (): FakeElement[] => descendants(element).filter((each) => each.localName === 'option')
  const isPopoverOpen = (): boolean => popover.open && element.isConnected
  const togglePopover = (open: boolean): void => {
    if (popover.open === open) return
    popover.open = open
    element.dispatchEvent(fakeEvent('toggle', { newState: open ? 'open' : 'closed', bubbles: false }))
  }
  const dataset = new Proxy({} as Record<string, string | undefined>, {
    get: (_, key) => (typeof key === 'string' ? attributes.get(dataAttribute(key)) : undefined),
    set: (_, key, value) => {
      setAttribute(dataAttribute(String(key)), String(value))
      return true
    },
    deleteProperty: (_, key) => {
      removeAttribute(dataAttribute(String(key)))
      return true
    },
    has: (_, key) => attributes.has(dataAttribute(String(key))),
    ownKeys: () => [...attributes.keys()].filter((name) => name.startsWith('data-')).map(datasetKey),
    getOwnPropertyDescriptor: (_, key) =>
      attributes.has(dataAttribute(String(key)))
        ? { enumerable: true, configurable: true, value: attributes.get(dataAttribute(String(key))) }
        : undefined,
  })
  Object.defineProperties(element, {
    tagName: { value: namespaceURI === HTML ? localName.toUpperCase() : localName },
    localName: { value: localName },
    namespaceURI: { value: namespaceURI },
    children: { get: () => element.childNodes.filter((child) => child.nodeType === 1) },
    attributes: { get: () => [...attributes].map(([name, value]) => ({ name, value })) },
    dataset: { value: dataset },
    style: {
      value: {
        setProperty: (name: string, value: string) => void styles.set(name, value),
        getPropertyValue: (name: string) => styles.get(name) ?? '',
        removeProperty: (name: string) => {
          const was = styles.get(name) ?? ''
          styles.delete(name)
          return was
        },
      },
    },
    classList: {
      value: {
        add: (...names: ReadonlyArray<string>) => writeClasses([...classes(), ...names]),
        remove: (...names: ReadonlyArray<string>) =>
          writeClasses(classes().filter((name) => !names.includes(name))),
        toggle: (name: string, force?: boolean) => {
          const on = force ?? !classes().includes(name)
          writeClasses(on ? [...classes(), name] : classes().filter((each) => each !== name))
          return on
        },
        contains: (name: string) => classes().includes(name),
      },
    },
    id: { get: () => attributes.get('id') ?? '', set: (value: string) => setAttribute('id', value) },
    className: {
      get: () => attributes.get('class') ?? '',
      set: (value: string) => setAttribute('class', value),
    },
    ...Object.fromEntries(BOOLEAN_ATTRIBUTES.map((name) => [name, booleanAttribute(name)])),
    open: {
      get: () => attributes.has('open'),
      set: (on: boolean) => {
        if (on === attributes.has('open')) return
        if (on) setAttribute('open', '')
        else removeAttribute('open')
        if (localName === 'details')
          element.dispatchEvent(fakeEvent('toggle', { newState: on ? 'open' : 'closed', bubbles: false }))
      },
    },
    name: { get: () => attributes.get('name') ?? '', set: (value: string) => setAttribute('name', value) },
    type: {
      get: () =>
        attributes.get('type') ?? (localName === 'input' ? 'text' : localName === 'button' ? 'submit' : ''),
      set: (value: string) => setAttribute('type', value),
    },
    rows: {
      get: () => Number(attributes.get('rows') ?? 2),
      set: (value: number) => setAttribute('rows', String(value)),
    },
    maxLength: {
      get: () => Number(attributes.get('maxlength') ?? -1),
      set: (value: number) => setAttribute('maxlength', String(value)),
    },
    selected: {
      get: () => dirty.selected ?? attributes.has('selected'),
      set: (on: boolean) => {
        dirty.selected = on
      },
    },
    options: { get: options },
    getAttribute: { value: (name: string) => attributes.get(name.toLowerCase()) ?? null },
    setAttribute: { value: setAttribute },
    removeAttribute: { value: removeAttribute },
    hasAttribute: { value: (name: string) => attributes.has(name.toLowerCase()) },
    toggleAttribute: {
      value: (name: string, force?: boolean) => {
        const on = force ?? !attributes.has(name)
        if (on) setAttribute(name, '')
        else removeAttribute(name)
        return on
      },
    },
    matches: { value: (selector: string) => matchesSelector(element, selector) },
    closest: {
      value: (selector: string) => {
        for (let current: FakeElement | null = element; current !== null; current = current.parentElement)
          if (matchesSelector(current, selector)) return current
        return null
      },
    },
    querySelector: {
      value: (selector: string) =>
        descendants(element).find((each) => matchesSelector(each, selector)) ?? null,
    },
    querySelectorAll: {
      value: (selector: string) => descendants(element).filter((each) => matchesSelector(each, selector)),
    },
    focus: {
      value: () => {
        const before = focusState().active
        if (before === element) return
        before?.blur()
        focusState().active = element
        valueAtFocus.value = VALUE_TAGS.has(localName) ? element.value : null
        element.dispatchEvent(fakeEvent('focus', { bubbles: false }))
        element.dispatchEvent(fakeEvent('focusin', { relatedTarget: before }))
      },
    },
    blur: {
      value: () => {
        if (focusState().active !== element) return
        focusState().active = null
        if (valueAtFocus.value !== null && valueAtFocus.value !== element.value)
          element.dispatchEvent(fakeEvent('change'))
        element.dispatchEvent(fakeEvent('blur', { bubbles: false }))
        element.dispatchEvent(fakeEvent('focusout'))
      },
    },
    click: { value: () => element.dispatchEvent(fakeEvent('click')) },
    showPopover: { value: () => togglePopover(true), configurable: true },
    hidePopover: { value: () => togglePopover(false), configurable: true },
    togglePopover: {
      configurable: true,
      value: () => {
        togglePopover(!isPopoverOpen())
        return popover.open
      },
    },
    showModal: {
      value: () => {
        setAttribute('open', '')
        descendants(element)
          .find((each) => each.hasAttribute('autofocus'))
          ?.focus()
      },
    },
    show: { value: () => setAttribute('open', '') },
    close: {
      value: () => {
        if (!attributes.has('open')) return
        removeAttribute('open')
        element.dispatchEvent(fakeEvent('close', { bubbles: false }))
      },
    },
    requestSubmit: { value: () => element.dispatchEvent(fakeEvent('submit')) },
    reportValidity: { value: () => true },
    checkVisibility: {
      value: () => {
        if (!element.isConnected) return false
        for (let current: FakeElement | null = element; current !== null; current = current.parentElement)
          if (current.hidden) return false
        return true
      },
    },
    scrollIntoView: { value: () => undefined },
    scrollTo: { value: () => undefined, writable: true },
    getContext: { value: () => null },
  })
  popoverState.set(element, isPopoverOpen)
  if (optionsOf.get(owner)?.popovers === false)
    for (const name of ['showPopover', 'hidePopover', 'togglePopover'])
      delete (element as unknown as Record<string, unknown>)[name]
  if (localName === 'input')
    Object.defineProperty(element, 'checked', {
      get: () => dirty.checked ?? attributes.has('checked'),
      set: (on: boolean) => {
        dirty.checked = on
        if (on && element.type === 'radio') uncheckOtherRadios(element)
      },
    })
  if (VALUE_TAGS.has(localName))
    Object.defineProperty(element, 'value', {
      get: () => {
        if (localName === 'select') {
          const all = options()
          return (
            (all.find((option) => option.selected) ?? (dirty.value === null ? all[0] : undefined))?.value ??
            ''
          )
        }
        if (localName === 'option') return attributes.get('value') ?? element.textContent
        if (localName === 'textarea') return dirty.value ?? element.textContent
        return (
          dirty.value ??
          attributes.get('value') ??
          (element.type === 'checkbox' || element.type === 'radio' ? 'on' : '')
        )
      },
      set: (value: string) => {
        if (localName === 'select') {
          for (const option of options()) option.selected = option.value === value
          dirty.value = value
          return
        }
        if (localName === 'option' || localName === 'button') return setAttribute('value', value)
        dirty.value = String(value)
      },
    })
  return element
}

const popoverState = new WeakMap<FakeElement, () => boolean>()

const uncheckOtherRadios = (radio: FakeElement): void => {
  const scope = radio.closest('form') ?? radio.ownerDocument.documentElement
  for (const other of scope.querySelectorAll('input'))
    if (other !== radio && other.type === 'radio' && other.name === radio.name) other.checked = false
}

const descendants = (node: FakeNode): FakeElement[] =>
  node.childNodes.flatMap((child) =>
    child.nodeType === 1 ? [child as FakeElement, ...descendants(child)] : descendants(child),
  )

const dataAttribute = (key: string): string =>
  `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`

const datasetKey = (attribute: string): string =>
  attribute.slice('data-'.length).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
