import { Task as T } from '@homingbird/kernel'
import { Unauthorized, Unavailable } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { type LocalSession, SIGN_IN_FIRST, type SessionState } from '../src/local-session.ts'
import { localAdapterOf, noticingRefusals } from '../src/local-tools.ts'
import { fakeApi } from './support.ts'

const sessionIn = (initial: SessionState, protocolProblem: string | null = null) => {
  let state = initial
  const session: LocalSession = {
    state: () => state,
    token: () => null,
    protocolProblem: () => protocolProblem,
    restore: T.unit,
    login: T.succeed('login'),
    status: T.succeed('status'),
    logout: T.succeed('logout'),
    credentialWasRefused: () => {
      state = { kind: 'signed_out', note: 'refused' }
    },
  }
  return session
}

describe('localAdapterOf', () => {
  it('offers login, status and logout, and none of them returns a credential', async () => {
    const adapter = localAdapterOf(sessionIn({ kind: 'signed_in' }))
    expect(adapter.tools.map((tool) => tool.name)).toEqual(['login', 'status', 'logout'])
    for (const tool of adapter.tools) expect(tool.description).not.toMatch(/token|password/i)
    expect(await T.runPromise(adapter.tools[0]!.run)).toBe('login')
  })

  it('blocks the other tools until signed in, naming the code while approval is pending', () => {
    expect(localAdapterOf(sessionIn({ kind: 'signed_in' })).blockedBecause()).toBeNull()
    expect(localAdapterOf(sessionIn({ kind: 'signed_out', note: null })).blockedBecause()).toBe(SIGN_IN_FIRST)
    expect(
      localAdapterOf(
        sessionIn({
          kind: 'pending',
          verificationUri: 'https://hb.example.com/#/device/BCDF-GHJK',
          userCode: 'BCDF-GHJK',
        }),
      ).blockedBecause(),
    ).toContain('confirm the code BCDF-GHJK')
  })

  it('blocks the other tools with one sentence when the server speaks a protocol it cannot read', () => {
    const problem = 'This Homingbird server is too old for this client; upgrade the server.'
    expect(localAdapterOf(sessionIn({ kind: 'signed_in' }, problem)).blockedBecause()).toBe(problem)
  })

  it('offers a login prompt that asks for the link only when the browser did not open', () => {
    const [prompt] = localAdapterOf(sessionIn({ kind: 'signed_in' })).prompts
    expect(prompt!.name).toBe('login')
    expect(prompt!.text({})).toMatch(/login tool.*If the browser did not open.*status/)
  })
})

describe('noticingRefusals', () => {
  it('signs the session out when the server no longer accepts the credential, and only then', async () => {
    const session = sessionIn({ kind: 'signed_in' })
    const wrapped = noticingRefusals(
      fakeApi({
        'me.get': () => Unavailable({ message: 'down' }),
        'drafts.list': () => Unauthorized({ message: 'revoked' }),
      }).api,
      session,
    )
    await T.run(wrapped['me.get']({}))
    expect(session.state().kind).toBe('signed_in')
    await T.run(wrapped['drafts.list']({}))
    expect(session.state()).toEqual({ kind: 'signed_out', note: 'refused' })
  })
})
