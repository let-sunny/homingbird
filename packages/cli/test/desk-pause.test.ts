import { Task as T, makeTestClock } from '@homingbird/kernel'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { deskClaimPath } from '../src/desk-claim.ts'
import { type PauseEnv, deskPausePath, isDeskPaused, pauseDesk, resumeDesk } from '../src/desk-pause.ts'

const pauseWorld = () => {
  const files = new Map<string, string>()
  const env: PauseEnv = {
    clock: makeTestClock(1_000),
    variables: {},
    homeDirectory: '/home/ana',
    files: {
      read: async (path) => files.get(path) ?? null,
      exists: async (path) => files.has(path),
      writePrivate: async (path, content) => void files.set(path, content),
      writeOwnerOnly: async (path, content) => void files.set(path, content),
      createExclusive: async () => false,
      remove: async (path) => void files.delete(path),
      list: async () => [],
    },
  }
  return { files, run: <A>(task: T.Task<A, never, PauseEnv>) => T.runPromise(task, env) }
}

const PATH = '/desks/one.paused'

describe('the desk pause flag', () => {
  it('sits beside the desk claim of the same server and member', () => {
    const env = { variables: {}, homeDirectory: '/home/ana' }
    expect(deskPausePath(env, 'https://a/', 'm')).toBe(
      deskClaimPath(env, 'https://a', 'm').replace(/\.json$/, '.paused'),
    )
  })

  it('ends paused after any pause and resumed after any resume, whatever came before', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), async (actions) => {
        const w = pauseWorld()
        let paused = false
        for (const pause of actions) {
          const changed = await w.run(pause ? pauseDesk(PATH) : resumeDesk(PATH))
          expect(changed).toBe(pause !== paused)
          paused = pause
          expect(await w.run(isDeskPaused(PATH))).toBe(paused)
        }
      }),
    )
  })

  it('records when it was paused', async () => {
    const w = pauseWorld()
    await w.run(pauseDesk(PATH))
    expect(JSON.parse(w.files.get(PATH)!)).toEqual({ pausedAt: 1_000 })
  })
})
