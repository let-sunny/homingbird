import { type HasClock, Iter, Schedule, Task as T } from '@homingbird/kernel'

/** Says when a load has taken longer than usual and then too long, by the clock service; `then` runs once it is too long. */
export const growingSlow = <E = never, R = unknown>(
  say: (step: 'slow' | 'long') => void,
  then: T.Task<void, E, R> = T.unit,
): T.Task<void, E, R & HasClock> =>
  T.gen(function* () {
    yield* T.sleep(USUAL_LOAD_SECONDS * 1000)
    say('slow')
    yield* T.sleep((TOO_LONG_LOAD_SECONDS - USUAL_LOAD_SECONDS) * 1000)
    say('long')
    yield* then
  })

/** The waits between a load's attempts: one, two, four and eight seconds, so it gives up after about fifteen. */
export const retryWaits = (): Iterable<number> => Iter.take(4)(Schedule.exponential(1000, 2, 8000))

/** What a normal connection needs to load the page, rounded up; above it the page says loading is slower than usual. */
export const USUAL_LOAD_SECONDS = 5

/** Above what the slowest connection we tested needs, and never under ten; above it the page offers to try again. */
export const TOO_LONG_LOAD_SECONDS = 15

/** After a failure that repeating did not mend, how long before the page quietly asks again. */
export const QUIET_RETRY_SECONDS = 30
