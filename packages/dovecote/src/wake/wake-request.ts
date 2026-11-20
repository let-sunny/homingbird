import { type HasClock, Task as T } from '@homingbird/kernel'
import type { Fetch } from '../auth/identity-provider.ts'
import type { WakeAnswer } from './wake-schedule.ts'
import { type WakeTarget, wakeBody } from './wake-target.ts'

/**
 * Sends one wake and reads only its status and Retry-After; the body is cancelled unread. A redirect is
 * not followed, so the token goes nowhere but the address the person saved.
 */
export const sendWake = (
  fetch: Fetch,
  target: WakeTarget,
  publicUrl: string,
): T.Task<WakeAnswer, never, HasClock> =>
  T.catchAll((error: 'unreachable' | { readonly _tag: 'TimeoutError' }) =>
    T.succeed<WakeAnswer>(error === 'unreachable' ? { status: 0, retryAfter: null } : 'timeout'),
  )(
    T.timeout(WAKE_TIMEOUT_MS)(
      T.gen(function* () {
        const response = yield* T.tryPromise(
          (signal) =>
            fetch(target.url, {
              method: 'POST',
              redirect: 'manual',
              headers: {
                ...Object.fromEntries(target.headers.map((header) => [header.name, header.value])),
                'content-type': 'application/json',
              },
              body: wakeBody(publicUrl),
              signal,
            }),
          () => 'unreachable' as const,
        )
        yield* unread(response)
        return { status: response.status, retryAfter: response.headers.get('retry-after') }
      }),
    ),
  )

export const WAKE_TIMEOUT_MS = 10_000

const unread = (response: Response): T.Task<void> =>
  T.catchAll(() => T.unit)(
    T.tryPromise(
      () => response.body?.cancel() ?? Promise.resolve(),
      () => 'not cancelled' as const,
    ),
  )
