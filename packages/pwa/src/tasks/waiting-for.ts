import { Task as T } from '@homingbird/kernel'
import type { ReadableSignal } from '@homingbird/ui'
import { type Action, withApp } from '../app.ts'
import type { PageEvent } from '../browser-page.ts'
import { TOO_LONG_LOAD_SECONDS, USUAL_LOAD_SECONDS } from '../load-timing.ts'

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

/** Says when a load has taken longer than usual and then too long, by the clock service; `then` runs once it is too long. */
export const growingSlow = (say: (step: 'slow' | 'long') => void, then: Action = T.unit): Action =>
  T.gen(function* () {
    yield* T.sleep(USUAL_LOAD_SECONDS * 1000)
    say('slow')
    yield* T.sleep((TOO_LONG_LOAD_SECONDS - USUAL_LOAD_SECONDS) * 1000)
    say('long')
    yield* then
  })
