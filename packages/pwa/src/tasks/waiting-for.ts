import { Task as T } from '@homingbird/kernel'
import type { ReadableSignal } from '@homingbird/ui'
import { type Action, withApp } from '../app.ts'

/** Ends, with `'again'`, the next time the counter changes; waiting for it costs nothing once the task is interrupted. */
export const untilChanged = (counter: ReadableSignal<number>): Action<'again'> =>
  T.promise(
    (signal) =>
      new Promise<'again'>((resolve) => {
        const stop = counter.subscribe(() => {
          stop()
          resolve('again')
        })
        signal.addEventListener('abort', stop, { once: true })
      }),
  )

/** Ends once the value is what is waited for, at once when it already is; it waits no longer than the session. */
export const untilHolds = <A>(source: ReadableSignal<A>, holds: (value: A) => boolean): Action =>
  withApp(({ ended }) =>
    T.suspend(() => {
      if (holds(source.get())) return T.unit
      return T.flatMap((isOver: boolean) => (isOver ? T.interrupt : T.unit))(
        T.promise(
          (signal) =>
            new Promise<boolean>((resolve) => {
              const finish = (isOver: boolean): void => {
                stop()
                resolve(isOver)
              }
              const stop = source.subscribe((value) => {
                if (holds(value)) finish(false)
              })
              signal.addEventListener('abort', stop, { once: true })
              ended.addEventListener('abort', () => finish(true), { once: true, signal })
            }),
        ),
      )
    }),
  )
