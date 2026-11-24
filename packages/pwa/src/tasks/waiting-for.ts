import { Task as T } from '@homingbird/kernel'
import type { ReadableSignal } from '@homingbird/ui'
import { type Action, withApp } from '../app.ts'
import type { PageEvent } from '../browser-page.ts'

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

/** Ends, with `'again'`, the next time the page hears of the event. */
export const untilPageEvent = (event: PageEvent): Action<'again'> =>
  withApp(({ page }) =>
    T.promise(
      (signal) =>
        new Promise<'again'>((resolve) => {
          const stop = page.on(event, () => {
            stop()
            resolve('again')
          })
          signal.addEventListener('abort', stop, { once: true })
        }),
    ),
  )
