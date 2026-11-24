import { Task as T } from '@homingbird/kernel'
import { type Action, withApp } from '../app.ts'
import type { Load, Resource } from '../resource.ts'
import { CHANNEL_PAGE_KEYS, againChannelPage } from './channel-pages.ts'
import { RESOURCE_KEYS, again } from './resources.ts'

/** Try again for each list and part of a page that failed or takes too long, and for no other. */
export const againWhatIsStuck: Action = T.suspend(() =>
  againWhere((step) => step === 'failed' || step === 'long'),
)

/** Asks afresh for each list and part of a page that failed, as when the network is back. */
export const againWhatFailed: Action = T.suspend(() => againWhere((step) => step === 'failed'))

const againWhere = (holds: (step: Load['step']) => boolean): Action =>
  withApp(({ state }) => {
    const isAt = (held: Pick<Resource<unknown>, 'load'> | null): boolean =>
      held !== null && holds(held.load.get().step)
    const parts = CHANNEL_PAGE_KEYS.flatMap((key) =>
      state[key]
        .keys()
        .filter((slug) => isAt(state[key].find(slug)))
        .map((slug) => againChannelPage(key, slug)),
    )
    return T.asUnit(T.all([again(...RESOURCE_KEYS.filter((key) => isAt(state[key]))), ...parts]))
  })
