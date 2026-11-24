import { type HasClock, Iter, Schedule, Task as T } from '@homingbird/kernel'

/** Says when a load has taken longer than usual and then too long, by the clock service. */
export const growingSlow = (say: (step: 'slow' | 'long') => void): T.Task<void, never, HasClock> =>
  T.gen(function* () {
    yield* T.sleep(USUAL_LOAD_SECONDS * 1000)
    say('slow')
    yield* T.sleep((TOO_LONG_LOAD_SECONDS - USUAL_LOAD_SECONDS) * 1000)
    say('long')
  })

/** The waits between a load's attempts: one, two, four and eight seconds, so it gives up after about fifteen. */
export const retryWaits = (): Iterable<number> => Iter.take(4)(Schedule.exponential(1000, 2, 8000))

/** What a normal connection needs to load the page, rounded up; above it the page says loading is slower than usual. */
export const USUAL_LOAD_SECONDS = 5

/** Above what the slowest connection we tested needs, and never under ten; above it the page offers to try again. */
export const TOO_LONG_LOAD_SECONDS = 15

/**
 * After this long an attempt to read a list counts as a lost connection, so that a request that never ends
 * holds nothing back. Twice what calls a load too long, whose slowest measured whole load (Slow 3G, 11.8
 * seconds at the 95th percentile) it leaves more than double the time.
 */
export const ATTEMPT_LIMIT_SECONDS = 30

/** How long the lists wait for the stream of events, which a working connection opens in one round trip. */
export const STREAM_WAIT_SECONDS = 1

/** After a failure that repeating did not mend, how long before the page quietly asks again. */
export const QUIET_RETRY_SECONDS = 30
