import { type Lifetime, type ReadableSignal, isSameData, signal } from '@homingbird/ui'
import { type Inside, type Load, NOT_ASKED, type Resource, type Tell, resource } from './resource.ts'

/**
 * One resource for each thing that a page of its own asks for, such as a channel's agent. An entry is made
 * when a page first holds its key and is gone when the last page that holds it ends, so it holds no more
 * than the pages show; a page that is drawn again holds it again before it is let go of. What the person may no longer see is emptied at once, held or not (rules 2 and 6).
 */
export const family = <A>(empty: A): Family<A> => {
  const entries = new Map<string, Entry<A>>()
  const summary = signal<Load>(NOT_ASKED)
  let heard: Tell | null = null

  const summarize = (): void => {
    const next = worstOf([...entries.values()].map((entry) => entry.resource.load.get()))
    if (!isSameData(summary.get(), next)) summary.set(next)
  }

  const made = (key: string): Entry<A> => {
    const existing = entries.get(key)
    if (existing !== undefined) return existing
    const held = resource(empty)
    const entry: Entry<A> = {
      resource: held,
      users: 0,
      read: heard === null ? null : held.inspect(heard),
      unsubscribe: held.load.subscribe(summarize),
    }
    entries.set(key, entry)
    summarize()
    return entry
  }

  const dropped = (key: string, entry: Entry<A>): void => {
    if (entries.get(key) !== entry) return
    entry.unsubscribe()
    entry.resource.reset()
    entries.delete(key)
    summarize()
  }

  return {
    use: (key, life) => {
      const entry = made(key)
      entry.users++
      life.add(() => {
        entry.users--
        if (entry.users === 0) queueMicrotask(() => entry.users === 0 && dropped(key, entry))
      })
      return entry.resource
    },
    keys: () => [...entries.keys()],
    find: (key) => entries.get(key)?.resource ?? null,
    keepOnly: (keys) => {
      for (const [key, entry] of entries) if (!keys.has(key)) entry.resource.reset()
    },
    reset: () => {
      for (const [key, entry] of [...entries]) dropped(key, entry)
    },
    load: { get: summary.get, subscribe: summary.subscribe },
    inspect: (tell) => {
      heard = tell
      for (const entry of entries.values()) entry.read = entry.resource.inspect(tell)
      return () =>
        insideAll([...entries.values()].flatMap((entry) => (entry.read === null ? [] : [entry.read()])))
    },
  }
}

export interface Family<A> {
  /** The resource of a key, made if no page holds it yet, and let go of when `life` ends. */
  readonly use: (key: string, life: Lifetime) => Resource<A>
  /** The resource of a key some page holds; nothing is made, so nothing is asked for what no page shows. */
  readonly find: (key: string) => Resource<A> | null
  /** The keys some page holds. */
  readonly keys: () => ReadonlyArray<string>
  /** What the person may see: every other entry is emptied and stops asking. */
  readonly keepOnly: (keys: ReadonlySet<string>) => void
  /** The session ended: every entry is emptied and let go of. */
  readonly reset: () => void
  /** The worst of the entries' loads, for the developers' view; nothing a page shows. */
  readonly load: ReadableSignal<Load>
  /** For developers: counts of what the entries hold, and how many there are as the items. */
  readonly inspect: (heard: Tell) => () => Inside
}

interface Entry<A> {
  readonly resource: Resource<A>
  users: number
  read: (() => Inside) | null
  readonly unsubscribe: () => void
}

const RANK: Readonly<Record<Load['step'], number>> = { idle: 0, loading: 1, slow: 2, long: 3, failed: 4 }

const worstOf = (loads: ReadonlyArray<Load>): Load => {
  const worst = loads.reduce<Load | null>(
    (now, load) => (now === null || RANK[load.step] > RANK[now.step] ? load : now),
    null,
  )
  if (worst === null) return NOT_ASKED
  return { loaded: loads.every((load) => load.loaded), step: worst.step, error: worst.error }
}

const insideAll = (all: ReadonlyArray<Inside>): Inside => ({
  running: all.some((inside) => inside.running),
  resting: all.some((inside) => inside.resting),
  queued: all.some((inside) => inside.queued),
  patches: all.reduce((sum, inside) => sum + inside.patches, 0),
  attempts: all.reduce((most, inside) => Math.max(most, inside.attempts), 0),
  items: all.length,
})
