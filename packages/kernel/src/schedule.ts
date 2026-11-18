export function* spaced(ms: number): Generator<number, never> {
  for (;;) yield ms
}

export function* exponential(
  base: number,
  factor = 2,
  max = Number.POSITIVE_INFINITY,
): Generator<number, never> {
  let delay = Math.min(max, base)
  for (;;) {
    yield delay
    delay = Math.min(max, delay * factor)
  }
}

export function* fibonacci(base: number): Generator<number, never> {
  let [current, next] = [base, base]
  for (;;) {
    yield current
    ;[current, next] = [next, current + next]
  }
}

export const jittered =
  (random: () => number, ratio = 0.5) =>
  (schedule: Iterable<number>): Iterable<number> => ({
    *[Symbol.iterator]() {
      for (const delay of schedule) yield delay * (1 - ratio + 2 * ratio * random())
    },
  })
