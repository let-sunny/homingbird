import { httpApi } from '@homingbird/client'
import { Task as T, makeTestClock } from '@homingbird/kernel'
import type { ApiError, MemberId } from '@homingbird/protocol'
import { fakeDovecote } from '../../src/dovecote.ts'
import { VISITOR_ID } from '../../src/team.ts'
import { type World, createWorld } from '../../src/world.ts'

/** The demo's Dovecote behind the real typed client, as one member, on a test clock. */
export const demoApi = (viewerId: MemberId = VISITOR_ID, world: World = createWorld(makeTestClock(NOW))) => {
  const fetch = fakeDovecote(world, viewerId)
  const api = httpApi({ serverUrl: 'http://demo.test', fetch })
  return { world, fetch, api, viewerId }
}

/** The value a task succeeds with; a refusal fails the test with its message. */
export const succeeded = <A>(task: T.Task<A, ApiError>): Promise<A> => T.runPromise(task)

/** The refusal a task fails with, or null when it succeeds. */
export const refused = <A>(task: T.Task<A, ApiError>): Promise<ApiError | null> =>
  T.run(task).then((exit) => (exit._tag === 'Err' && exit.error._tag === 'Fail' ? exit.error.error : null))

export const NOW = Date.UTC(2026, 10, 21, 9)

/** A seeded member, found by their name. */
export const memberNamed = (world: World, name: string): MemberId => {
  const found = world.records().members.find((each) => each.member.name === name)
  if (found === undefined) throw new Error(`no member named ${name}`)
  return found.member.id
}

/** A seeded note, found by the start of its text. */
export const noteStarting = (world: World, text: string) => {
  const found = world.records().notes.find((note) => note.body.startsWith(text))
  if (found === undefined) throw new Error(`no note starting ${text}`)
  return found
}
