import { type Clock, Task as T } from '@homingbird/kernel'
import type { Unsubscribe } from './signal.ts'

/** Runs `action` once after `ms` on the given clock; the returned function cancels it if it has not run. */
export const later = (clock: Clock, ms: number, action: () => void): Unsubscribe => {
  const running = T.runFork(T.map(action)(T.sleep(ms)), { clock })
  return () => void running.interrupt()
}
