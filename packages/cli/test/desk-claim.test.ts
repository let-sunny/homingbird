import { Task as T, makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import {
  type ClaimEnv,
  DESK_CLAIM_STALE_MS,
  claimDesk,
  deskClaimPath,
  releaseDeskClaim,
  renewDeskClaim,
} from '../src/desk-claim.ts'

const claimWorld = () => {
  const files = new Map<string, string>()
  const clock = makeTestClock(1_000_000)
  const env: ClaimEnv = {
    clock,
    variables: {},
    homeDirectory: '/home/ana',
    files: {
      read: (path) => T.sync(() => files.get(path) ?? null),
      exists: (path) => T.sync(() => files.has(path)),
      writePrivate: (path, content) => T.sync(() => void files.set(path, content)),
      writeOwnerOnly: (path, content) => T.sync(() => void files.set(path, content)),
      createExclusive: (path, content) =>
        T.sync(() => {
          if (files.has(path)) return false
          files.set(path, content)
          return true
        }),
      remove: (path) => T.sync(() => void files.delete(path)),
      list: () => T.sync(() => []),
      mode: () => T.sync(() => null),
      isWritable: () => T.sync(() => true),
    },
  }
  const run = <A>(task: T.Task<A, never, ClaimEnv>) => T.runPromise(task, env)
  return { files, clock, run }
}

const PATH = '/claims/desk.json'

describe('the desk claim', () => {
  it('lives with the credentials, one per server and member', () => {
    expect(
      deskClaimPath({ variables: {}, homeDirectory: '/home/ana' }, 'https://hb.example.com/', 'mem_1'),
    ).toBe('/home/ana/.config/homingbird/desks/https%3A%2F%2Fhb.example.com~mem_1.json')
    expect(
      deskClaimPath({ variables: { XDG_CONFIG_HOME: '/x' }, homeDirectory: '/home/ana' }, 'https://a', 'm'),
    ).toBe('/x/homingbird/desks/https%3A%2F%2Fa~m.json')
  })

  it('goes to the first runner, and to a second only once the first stops or goes silent', async () => {
    const w = claimWorld()
    expect(await w.run(claimDesk(PATH, 'first'))).toBe(true)
    expect(await w.run(claimDesk(PATH, 'second'))).toBe(false)
    expect(await w.run(claimDesk(PATH, 'first'))).toBe(true)
    await w.clock.advance(DESK_CLAIM_STALE_MS - 1)
    expect(await w.run(claimDesk(PATH, 'second'))).toBe(false)
    await w.clock.advance(1)
    expect(await w.run(claimDesk(PATH, 'second'))).toBe(true)
    expect(await w.run(renewDeskClaim(PATH, 'first'))).toBe(false)
    await w.run(releaseDeskClaim(PATH, 'first'))
    expect(w.files.has(PATH)).toBe(true)
    await w.run(releaseDeskClaim(PATH, 'second'))
    expect(w.files.has(PATH)).toBe(false)
    expect(await w.run(claimDesk(PATH, 'first'))).toBe(true)
  })

  it('renews a live claim and replaces one it cannot read', async () => {
    const w = claimWorld()
    expect(await w.run(claimDesk(PATH, 'first'))).toBe(true)
    await w.clock.advance(DESK_CLAIM_STALE_MS - 1)
    expect(await w.run(renewDeskClaim(PATH, 'first'))).toBe(true)
    await w.clock.advance(DESK_CLAIM_STALE_MS - 1)
    expect(await w.run(claimDesk(PATH, 'second'))).toBe(false)
    for (const unreadable of ['not json', 'null', '{"holder":1}'] as const) {
      w.files.set(PATH, unreadable)
      expect(await w.run(claimDesk(PATH, 'second'))).toBe(true)
    }
    w.files.delete(PATH)
    expect(await w.run(renewDeskClaim(PATH, 'third'))).toBe(true)
  })
})
