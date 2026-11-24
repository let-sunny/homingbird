import type { Fetch } from '@homingbird/client'
import { Task as T } from '@homingbird/kernel'
import type { Api, ApiError } from '@homingbird/protocol'
import { codeNameIn } from './code-name.ts'
import { type Outcome, type Recording, tagOf } from './recording.ts'

/**
 * The server's API where each request is recorded by its route's name, how long it took, how it went and
 * the HTTP status that came. Each request gets an API of its own, whose fetch notes nothing but the status.
 */
export const tracedApi = (makeApi: (fetch: Fetch) => Api, fetch: Fetch, recording: Recording): Api =>
  new Proxy(makeApi(fetch), {
    get: (routes, key) => {
      const name = codeNameIn(routes, key)
      if (name === null) return Reflect.get(routes, key)
      return (request: never) =>
        T.make<unknown, ApiError>((environment, signal) => {
          let status: number | null = null
          const noting: Fetch = (url, init) =>
            fetch(url, init).then((response) => {
              status = response.status
              return response
            })
          const ended = recording.asked(name)
          const asked = makeApi(noting)[name as string as keyof Api](request) as T.Task<unknown, ApiError>
          return asked.run(environment, signal).then((exit) => {
            ended(outcomeOf(exit), status)
            return exit
          })
        })
    },
  })

const outcomeOf = (exit: T.Exit<unknown, ApiError>): Outcome => {
  if (exit._tag === 'Ok') return 'ok'
  if (exit.error._tag === 'Fail') return tagOf(exit.error.error)
  return exit.error._tag === 'Interrupt' ? 'interrupted' : 'broke'
}
