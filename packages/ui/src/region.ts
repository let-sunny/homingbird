import { type Child, h, replaceChildren } from './element.ts'
import { keepingPlace } from './keep-place.ts'
import { keyedOperations } from './keyed.ts'
import { type ReadableSignal, type Unsubscribe, onAnyChange } from './signal.ts'

export interface Lifetime {
  readonly add: (release: Unsubscribe) => void
  readonly end: () => void
}

export const lifetime = (): Lifetime => {
  const releases: Unsubscribe[] = []
  return {
    add: (release) => void releases.push(release),
    end: () => releases.splice(0).forEach((release) => release()),
  }
}

/**
 * An element whose content is drawn again whenever one of its sources changes. Each drawing gets a
 * lifetime of its own that ends when it is replaced, so what it subscribes to goes with it. Drawing
 * again keeps the page in place and the focus on the control the person was using.
 */
export const region = (
  life: Lifetime,
  sources: ReadonlyArray<ReadableSignal<unknown>>,
  render: (drawing: Lifetime) => Child,
  properties: { readonly class?: string; readonly data?: Readonly<Record<string, string>> } = {},
): HTMLElement => {
  const host = h('div', { ...properties, class: properties.class ?? 'region' })
  let drawing = lifetime()
  const draw = (): void => {
    drawing.end()
    drawing = lifetime()
    keepingPlace(host, () => replaceChildren(host, render(drawing)))
  }
  draw()
  life.add(onAnyChange(sources, draw))
  life.add(() => drawing.end())
  return host
}

export interface KeyedList<Item> {
  readonly key: (item: Item) => string
  readonly signature: (item: Item) => string
  readonly render: (item: Item) => HTMLElement
}

export const keyedRegion = <Item>(
  life: Lifetime,
  host: HTMLElement,
  sources: ReadonlyArray<ReadableSignal<unknown>>,
  items: () => ReadonlyArray<Item>,
  list: KeyedList<Item>,
): HTMLElement => {
  const rendered = new Map<string, { node: HTMLElement; signature: string }>()
  let order: string[] = []
  const draw = (): void => keepingPlace(host, () => drawItems(items()))
  const drawItems = (next: ReadonlyArray<Item>): void => {
    const nextOrder = next.map(list.key)
    for (const item of next) {
      const key = list.key(item)
      const signature = list.signature(item)
      const existing = rendered.get(key)
      if (existing?.signature === signature) continue
      const node = list.render(item)
      existing?.node.replaceWith(node)
      rendered.set(key, { node, signature })
    }
    for (const operation of keyedOperations(order, nextOrder)) {
      const node = rendered.get(operation.key)!.node
      if (operation.type === 'remove') {
        node.remove()
        rendered.delete(operation.key)
      } else host.insertBefore(node, operation.before === null ? null : rendered.get(operation.before)!.node)
    }
    order = nextOrder
  }
  draw()
  life.add(onAnyChange(sources, draw))
  return host
}
