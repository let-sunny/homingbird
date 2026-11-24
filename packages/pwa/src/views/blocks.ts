import { type Lifetime, type ReadableSignal, keyedRegion, lifetime } from '@homingbird/ui'

/**
 * A page in blocks, each drawn again only when what it is drawn from changes: the others stay the same
 * elements, so a field keeps its text, its caret and a character being composed, and a button stays where
 * it is pressed, whatever else on the page changes.
 */
export const blocks = <Host extends HTMLElement>(
  life: Lifetime,
  host: Host,
  source: ReadableSignal<unknown>,
  list: () => ReadonlyArray<Block | null>,
): Host => {
  const lives = new Map<string, Lifetime>()
  life.add(() => {
    for (const drawing of lives.values()) drawing.end()
  })
  const present = (): ReadonlyArray<Block> => {
    const now = list().filter((one) => one !== null)
    const keys = new Set(now.map((one) => one.key))
    for (const [key, drawing] of lives) {
      if (keys.has(key)) continue
      drawing.end()
      lives.delete(key)
    }
    return now
  }
  keyedRegion(life, host, [source], present, {
    key: (one) => one.key,
    signature: (one) => JSON.stringify(one.from),
    render: (one) => {
      lives.get(one.key)?.end()
      const drawing = lifetime()
      lives.set(one.key, drawing)
      return one.draw(drawing)
    },
  })
  return host
}

export interface Block {
  readonly key: string
  /** Everything it is drawn from. */
  readonly from: unknown
  readonly draw: (drawing: Lifetime) => HTMLElement
}
