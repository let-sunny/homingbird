import { type Deferred, Task as T, makeDeferred } from '@homingbird/kernel'

export interface WorkTally {
  readonly started: () => void
  readonly finished: () => void
  readonly settled: T.Task<void>
}

export const makeWorkTally = (): WorkTally => {
  let outstanding = 0
  let idle = resolved()
  return {
    started: () => {
      if (outstanding++ === 0) idle = makeDeferred<void>()
    },
    finished: () => {
      if (--outstanding === 0) idle.resolve(undefined)
    },
    settled: T.suspend(() => idle.wait),
  }
}

const resolved = (): Deferred<void> => {
  const done = makeDeferred<void>()
  done.resolve(undefined)
  return done
}
