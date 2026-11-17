/**
 * Retry and repeat schedules are plain generators of delays in milliseconds. Compose them with
 * the `Iter` combinators: `pipe(Schedule.exponential(100), Iter.take(5))`.
 */

/** The same delay forever. */
export function* spaced(ms: number): Generator<number, never> {
  for (;;) yield ms
}

/** `base, base * factor, base * factor^2, ...` capped at `max`. */
export function* exponential(base: number, factor = 2, max = Number.POSITIVE_INFINITY): Generator<number, never> {
  for (let delay = base; ; delay = Math.min(max, delay * factor)) yield Math.min(max, delay)
}

/** `a, b, a + b, ...` scaled by `base` milliseconds. */
export function* fibonacci(base: number): Generator<number, never> {
  for (let [a, b] = [base, base]; ; [a, b] = [b, a + b]) yield a
}

/** Spreads each delay uniformly over `[delay * (1 - ratio), delay * (1 + ratio)]`. */
export const jittered =
  (random: () => number, ratio = 0.5) =>
  (schedule: Iterable<number>): Iterable<number> => ({
    *[Symbol.iterator]() {
      for (const delay of schedule) yield delay * (1 - ratio + 2 * ratio * random())
    },
  })
