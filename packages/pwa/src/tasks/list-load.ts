import { Task as T } from '@homingbird/kernel'
import type { Action, App } from '../app.ts'
import { TOO_LONG_LOAD_SECONDS } from '../load-timing.ts'
import type { ListName } from '../state.ts'
import { untilChanged } from './waiting-for.ts'

/**
 * Loads a list that loads on its own and tells the list how it is going: too long after the usual 15 seconds,
 * or failed. A newer load of the same list ends this one, so Try again never leaves two running. The list itself
 * tells a failure while it is still waited for; otherwise, or when the session ended, the caller is told.
 */
export const loadingList = <A>(name: ListName, isWaitedFor: boolean, load: Action<A>): Action<A> =>
  T.gen(function* () {
    const { state } = yield* T.ask<App>()
    const list = state.listLoads[name]
    list.started.update((count) => count + 1)
    list.step.set('loading')
    const answered = yield* T.scoped((scope) =>
      T.gen(function* () {
        yield* scope.fork(sayTooLong(() => list.step.set('long')))
        return yield* T.race([T.result(load), T.map(() => NEWER)(untilChanged(list.started))])
      }),
    )
    if (answered === NEWER) return yield* T.interrupt
    if (answered._tag === 'Err') {
      list.step.set('failed')
      if (isWaitedFor && answered.error._tag !== 'Unauthorized') return yield* T.interrupt
      return yield* T.fail(answered.error)
    }
    return answered.value
  })

const NEWER = 'newer' as const

const sayTooLong = (say: () => void): Action =>
  T.gen(function* () {
    yield* T.sleep(TOO_LONG_LOAD_SECONDS * 1000)
    say()
  })
