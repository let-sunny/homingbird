import { Task as T } from '@homingbird/kernel'
import { NotFound, PROTOCOL_VERSION, Unauthorized } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { CliFailure, EXIT, SIGNED_OUT_MESSAGE } from '../src/failure.ts'
import { apiFor, calling, openSession, requireReadable } from '../src/session.ts'
import { AGENT_TOKEN, SERVER, world } from './support.ts'

const INFO = {
  name: 'dovecote',
  version: '1.0.0',
  contactMode: 'open',
  signInWith: 'Development login',
  protocolVersion: PROTOCOL_VERSION,
} as const

describe('session', () => {
  it('opens on the stored credential and calls its server with its token', async () => {
    const w = world({ stubs: { 'drafts.list': () => ({ drafts: [] }) } })
    const exit = await T.run(
      T.gen(function* () {
        const session = yield* openSession
        return yield* calling(session.api['drafts.list']({}))
      }),
      w.env,
    )
    expect(exit).toEqual({ _tag: 'Ok', value: { drafts: [] } })
    expect(w.calls).toEqual([
      expect.objectContaining({ route: 'drafts.list', authorization: `Bearer ${AGENT_TOKEN}` }),
    ])
  })

  it('refuses to open signed out, saying how to sign in, without calling the server', async () => {
    const w = world({ signedIn: 'none' })
    expect(await T.run(openSession, w.env)).toEqual({
      _tag: 'Err',
      error: T.failCause(CliFailure({ message: SIGNED_OUT_MESSAGE, exitCode: EXIT.signedOut })),
    })
    expect(w.calls).toEqual([])
  })

  it('builds an API for any credential against the server it names', async () => {
    const w = world({ stubs: { 'drafts.list': () => ({ drafts: [] }) } })
    const api = apiFor(w.env, { serverUrl: SERVER, token: 'hba_other-token-0123456789abcdefghij' })
    await T.run(api['drafts.list']({}))
    expect(w.calls[0]).toMatchObject({
      path: '/api/v1/drafts',
      authorization: 'Bearer hba_other-token-0123456789abcdefghij',
    })
  })

  it('accepts a server that speaks its protocol, and says which side to upgrade otherwise', async () => {
    const current = world({ stubs: { 'server.info': () => INFO } })
    expect(
      await T.run(requireReadable(apiFor(current.env, { serverUrl: SERVER, token: AGENT_TOKEN }))),
    ).toEqual({
      _tag: 'Ok',
      value: undefined,
    })
    const newer = world({
      stubs: { 'server.info': () => ({ ...INFO, protocolVersion: PROTOCOL_VERSION + 1 }) },
    })
    const exit = await T.run(requireReadable(apiFor(newer.env, { serverUrl: SERVER, token: AGENT_TOKEN })))
    expect(exit).toMatchObject({ _tag: 'Err', error: { _tag: 'Fail', error: { exitCode: EXIT.failed } } })
    expect(JSON.stringify(exit)).toMatch(/upgrade/i)
  })

  it('turns what the server refuses into command-line failures', async () => {
    expect(await T.run(calling(T.fail(Unauthorized({ message: 'revoked' }))))).toEqual({
      _tag: 'Err',
      error: T.failCause(CliFailure({ message: SIGNED_OUT_MESSAGE, exitCode: EXIT.signedOut })),
    })
    expect(await T.run(calling(T.fail(NotFound({ message: 'No such note.' }))))).toEqual({
      _tag: 'Err',
      error: T.failCause(CliFailure({ message: 'No such note.', exitCode: EXIT.failed })),
    })
  })
})
