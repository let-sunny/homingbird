import { Task as T } from '@homingbird/kernel'
import type { Fetch } from './http-api.ts'

/** Asks the server to revoke a credential: true only when it confirmed; one it cannot reach confirms nothing. */
export const isRevokedOnServer = (fetch: Fetch, serverUrl: string, token: string): T.Task<boolean> =>
  T.gen(function* () {
    const answered = yield* T.result(
      T.tryPromise(
        (signal) =>
          fetch(`${serverUrl}/oauth/revoke`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }).toString(),
            signal,
          }),
        () => 'unreachable' as const,
      ),
    )
    return answered._tag === 'Ok' && answered.value.ok
  })
