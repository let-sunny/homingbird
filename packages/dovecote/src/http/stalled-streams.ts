import { type HasClock, Task as T, ok } from '@homingbird/kernel'

/** Writes a chunk and waits for the reader; false when the reader stalled and the stream is to close. */
export const writeDrained = (
  target: Drainable,
  chunk: string | Uint8Array,
): T.Task<boolean, never, HasClock> =>
  T.suspend(() =>
    target.write(chunk)
      ? T.succeed(true)
      : T.race([untilDrained(target), T.map(() => false)(T.sleep(STREAM_DRAIN_TIMEOUT_MS))]),
  )

/** Counts unanswered pings; once `MISSED_PONGS_BEFORE_CLOSING` went unanswered the socket is stalled. */
export const pongWatch = (): PongWatch => {
  let unanswered = 0
  return {
    pinged: () => {
      unanswered++
    },
    ponged: () => {
      unanswered = 0
    },
    isStalled: () => unanswered >= MISSED_PONGS_BEFORE_CLOSING,
  }
}

export interface PongWatch {
  readonly pinged: () => void
  readonly ponged: () => void
  readonly isStalled: () => boolean
}

export interface Drainable {
  readonly write: (chunk: string | Uint8Array) => boolean
  readonly once: (event: 'drain', listener: () => void) => unknown
  readonly removeListener: (event: 'drain', listener: () => void) => unknown
}

export const STREAM_DRAIN_TIMEOUT_MS = 60_000

export const MISSED_PONGS_BEFORE_CLOSING = 2

const untilDrained = (target: Drainable): T.Task<boolean> =>
  T.async<boolean>((resume) => {
    const drained = (): void => resume(ok(true))
    target.once('drain', drained)
    return () => target.removeListener('drain', drained)
  })
