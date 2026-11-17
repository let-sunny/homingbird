import { readFile, stat } from 'node:fs/promises'
import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentToken } from '../src/agent-sign-in.ts'
import { readCredential, storeCredential } from '../src/credential-file.ts'
import { type RunningServer, SERVER_URL, startRunningServer } from './running-server.ts'

let running: RunningServer

beforeEach(async () => {
  running = await startRunningServer()
})

afterEach(() => running.server.close())

const signIn = () =>
  T.run(
    agentToken({
      serverUrl: SERVER_URL,
      clientName: 'Cursor',
      credentialPath: running.credentialPath,
      announce: (line) => running.announced.push(line),
      fetch: running.fetch,
    }),
    { clock: running.server.clock },
  )

const tokenOf = async (pending: ReturnType<typeof signIn>): Promise<string> => {
  const exit = await pending
  if (exit._tag === 'Err') throw new Error(`sign-in failed: ${JSON.stringify(exit.error)}`)
  return exit.value
}

describe('agentToken', () => {
  it('signs in with the device flow, announces where to approve, and stores the credential privately', async () => {
    const pending = signIn()
    await running.approveAnnouncedCode()
    const token = await tokenOf(pending)
    expect(running.announced[0]).toMatch(
      /^Homingbird: to connect this agent, open http:\/\/localhost:8080\/#\/device\/[A-Z]{4}-[A-Z]{4} and confirm the code [A-Z]{4}-[A-Z]{4}\.$/,
    )
    expect(running.announced.at(-1)).toBe('Homingbird: connected.')
    expect(running.announced.join('\n')).not.toContain(token)
    expect((await stat(running.credentialPath)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(running.credentialPath, 'utf8'))[SERVER_URL].token).toBe(token)
    const me = await running.server.request('GET', '/api/v1/me', { token })
    expect(me.json.credential).toMatchObject({ kind: 'agent', name: 'Cursor on laptop' })
  })

  it('never asks for the approve scope', async () => {
    const pending = signIn()
    await running.approveAnnouncedCode()
    await tokenOf(pending)
    const started = running.recorded.find((call) => call.path === '/oauth/device_authorization')!
    expect(new URLSearchParams(started.body).get('scope')).toBe('notes')
    const credentials = (await running.owner.api('GET', '/credentials')).json.credentials
    expect(credentials.filter((credential: any) => credential.client === 'Cursor').map((c: any) => c.kind)).toEqual([
      'agent',
    ])
  })

  it('reuses a stored credential the server still accepts, without a new sign-in', async () => {
    const first = signIn()
    await running.approveAnnouncedCode()
    const token = await tokenOf(first)
    running.announced.length = 0
    running.recorded.length = 0
    expect(await tokenOf(signIn())).toBe(token)
    expect(running.announced).toEqual([])
    expect(running.recorded.map((call) => call.path)).toEqual(['/api/v1/me'])
  })

  it('signs in again when the stored credential was revoked', async () => {
    const first = signIn()
    await running.approveAnnouncedCode()
    const revoked = await tokenOf(first)
    const listed = (await running.owner.api('GET', '/credentials')).json.credentials
    await running.owner.api('DELETE', `/credentials/${listed.find((c: any) => c.kind === 'agent').id}`)
    const second = signIn()
    await running.approveAnnouncedCode()
    expect(await tokenOf(second)).not.toBe(revoked)
  })

  it('signs in again when the stored credential is about to expire, without trying it', async () => {
    const now = running.server.clock.now()
    await T.runPromise(storeCredential(running.credentialPath, SERVER_URL, { token: 'hba_old', expiresAt: now + 59_000 }))
    const pending = signIn()
    await running.approveAnnouncedCode()
    const token = await tokenOf(pending)
    expect(token).not.toBe('hba_old')
    expect(running.recorded.some((call) => call.path === '/api/v1/me')).toBe(false)
    const stored = await T.runPromise(readCredential(running.credentialPath, SERVER_URL))
    expect(stored!.expiresAt).toBeGreaterThan(now + 24 * 60 * 60_000)
  })

  it('fails when the person denies the request', async () => {
    const pending = signIn()
    await running.approveAnnouncedCode({ approve: false })
    expect(await pending).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'Fail', error: { _tag: 'DeviceFlowFailed', reason: 'denied' } },
    })
  })

  it('uses the global fetch when none is given', async () => {
    const exit = await T.run(
      agentToken({
        serverUrl: 'http://127.0.0.1:9',
        clientName: 'Cursor',
        credentialPath: running.credentialPath,
        announce: () => {},
      }),
      { clock: running.server.clock },
    )
    expect(exit).toMatchObject({ _tag: 'Err', error: { _tag: 'Fail', error: { reason: 'unreachable' } } })
  })
})
