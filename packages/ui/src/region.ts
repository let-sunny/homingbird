import { type Child, h, replaceChildren } from './element.ts'
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

export const region = (
  life: Lifetime,
  sources: ReadonlyArray<ReadableSignal<unknown>>,
  render: () => Child,
  properties: { readonly class?: string; readonly data?: Readonly<Record<string, string>> } = {},
): HTMLElement => {
  const host = h('div', { ...properties, class: properties.class ?? 'region' })
  const draw = (): void => replaceChildren(host, render())
  draw()
  life.add(onAnyChange(sources, draw))
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
  const draw = (): void => {
    const next = items()
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
