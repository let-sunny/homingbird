import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Fetch } from '@homingbird/client'
import { Task as T } from '@homingbird/kernel'
import { UPGRADE_SENTENCES } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { storeCredential } from '../src/credential-file.ts'
import {
  type LocalSession,
  type LocalSessionOptions,
  REMOVED_ONLY_HERE,
  REVOKED_AND_REMOVED,
  RUNNERS_CREDENTIAL,
  makeLocalSession,
} from '../src/local-session.ts'
import { type RunningServer, SERVER_URL, startRunningServer } from './running-server.ts'

let running: RunningServer
let endScope: () => void

beforeEach(async () => {
  running = await startRunningServer()
})

afterEach(() => {
  endScope()
  running.server.close()
})

const sessionWith = (options: Partial<LocalSessionOptions> = {}): LocalSession => {
  const ended = new AbortController()
  let scope: T.Scope | undefined
  void T.run(
    T.scoped((opened) => {
      scope = opened
      return T.never
    }),
    undefined,
    ended.signal,
  )
  endScope = () => ended.abort()
  return makeLocalSession({
    serverUrl: SERVER_URL,
    clientName: 'Cursor on laptop',
    credentialPath: running.credentialPath,
    scope: scope!,
    clock: running.server.clock,
    fetch: running.fetch,
    ...options,
  })
}

const stored = async (): Promise<Record<string, { token: string; expiresAt: number }>> =>
  JSON.parse(await readFile(running.credentialPath, 'utf8'))

const signIn = async (session: LocalSession): Promise<void> => {
  await running.decide(await T.runPromise(session.login))
  await running.until(() => session.state().kind === 'signed_in')
}

describe('makeLocalSession', () => {
  it('starts signed out, holding no credential, and says how to sign in', async () => {
    const session = sessionWith()
    expect(session.state()).toEqual({ kind: 'signed_out', note: null })
    expect(session.token()).toBeNull()
    expect(await T.runPromise(session.status)).toBe(`Not signed in to ${SERVER_URL}. Call login to sign in.`)
  })

  it('signs in through the browser approval, waiting while it is pending, and stores the credential', async () => {
    const session = sessionWith()
    const asked = await T.runPromise(session.login)
    expect(asked).toMatch(/^To sign in, show your human this link: .*#\/device\/[A-Z]{4}-[A-Z]{4}/)
    expect(session.state().kind).toBe('pending')
    const waiting = await T.runPromise(session.status)
    expect(waiting).toMatch(
      /^Waiting for approval in the browser\. Open .* and confirm the code [A-Z]{4}-[A-Z]{4}\.$/,
    )
    expect(await T.runPromise(session.login)).toBe(waiting)
    await running.decide(asked)
    await running.until(() => session.state().kind === 'signed_in')
    const token = session.token()
    expect(token).toMatch(/^hba_/)
    expect((await stored())[SERVER_URL]!.token).toBe(token)
    expect(await T.runPromise(session.status)).toMatch(
      new RegExp(
        `^Signed in to ${SERVER_URL} as Ana <ana@example\\.com>, with the credential "Cursor on laptop"\\.`,
      ),
    )
    expect(await T.runPromise(session.login)).toBe(
      'Already signed in to Homingbird. Call status to see as whom.',
    )
  })

  it('says the browser was opened when it could open one', async () => {
    const opened: string[] = []
    const session = sessionWith({ openInBrowser: (url) => T.sync(() => opened.push(url) > 0) })
    const asked = await T.runPromise(session.login)
    expect(asked).toMatch(/^The browser was opened at /)
    expect(opened).toEqual([expect.stringMatching(/#\/device\/[A-Z]{4}-[A-Z]{4}$/)])
  })

  it('signs out with a note when the sign-in is denied, and lets login start again', async () => {
    const session = sessionWith()
    await running.decide(await T.runPromise(session.login), { approve: false })
    await running.until(() => session.state().kind === 'signed_out')
    expect(session.state()).toEqual({
      kind: 'signed_out',
      note: 'The request was denied in the browser. Call login to try again.',
    })
    expect(await T.runPromise(session.status)).toContain('The request was denied in the browser.')
    expect(await T.runPromise(session.login)).toMatch(/^To sign in/)
  })

  it('says it could not start signing in when the server cannot be reached', async () => {
    const unreachable: Fetch = () => Promise.reject(new Error('offline'))
    const session = sessionWith({ fetch: unreachable })
    expect(await T.runPromise(session.login)).toBe(
      `Could not start signing in to ${SERVER_URL}: The Homingbird server could not be reached.`,
    )
    expect(session.state().kind).toBe('signed_out')
  })

  it('restores a stored credential unless it is about to expire', async () => {
    const now = running.server.clock.now()
    await T.runPromise(
      storeCredential(running.credentialPath, SERVER_URL, { token: 'hba_x', expiresAt: now + 61_000 }),
    )
    const restored = sessionWith()
    await T.runPromise(restored.restore)
    expect(restored.state().kind).toBe('signed_in')
    expect(restored.token()).toBe('hba_x')
    endScope()
    await T.runPromise(
      storeCredential(running.credentialPath, SERVER_URL, { token: 'hba_x', expiresAt: now + 60_000 }),
    )
    const expiring = sessionWith()
    await T.runPromise(expiring.restore)
    expect(expiring.state().kind).toBe('signed_out')
  })

  it('signs out and forgets a stored credential the server no longer accepts', async () => {
    const now = running.server.clock.now()
    await T.runPromise(
      storeCredential(running.credentialPath, SERVER_URL, { token: 'hba_gone', expiresAt: now + 3_600_000 }),
    )
    const session = sessionWith()
    await T.runPromise(session.restore)
    expect(await T.runPromise(session.status)).toBe(
      `Not signed in to ${SERVER_URL}. The stored credential is no longer accepted. Call login to sign in.`,
    )
    expect(session.state().kind).toBe('signed_out')
    expect(await stored()).toEqual({})
  })

  it('says a signed-in session cannot reach its server, without signing it out', async () => {
    let reachable = true
    const session = sessionWith({
      fetch: (url, init) => (reachable ? running.fetch(url, init) : Promise.reject(new Error('offline'))),
    })
    await signIn(session)
    reachable = false
    expect(await T.runPromise(session.status)).toBe(
      `Signed in to ${SERVER_URL}, but it cannot be reached right now.`,
    )
    expect(session.state().kind).toBe('signed_in')
  })

  it('signs out when told the credential was refused, and only when signed in', async () => {
    const session = sessionWith()
    session.credentialWasRefused()
    expect(session.state()).toEqual({ kind: 'signed_out', note: null })
    await signIn(session)
    session.credentialWasRefused()
    expect(session.state()).toEqual({
      kind: 'signed_out',
      note: 'The stored credential is no longer accepted.',
    })
    expect(session.token()).toBeNull()
  })

  it('logs out by revoking the credential on the server and removing it here', async () => {
    const session = sessionWith()
    expect(await T.runPromise(session.logout)).toBe(
      'Signed out of Homingbird. No credential was stored on this device.',
    )
    await signIn(session)
    expect(await T.runPromise(session.logout)).toBe(REVOKED_AND_REMOVED)
    expect(session.state()).toEqual({ kind: 'signed_out', note: null })
    expect(await stored()).toEqual({})
  })

  it('says the credential may still work when the server did not confirm the revocation', async () => {
    const session = sessionWith({
      fetch: (url, init) =>
        url.endsWith('/oauth/revoke')
          ? Promise.resolve(new Response('', { status: 503 }))
          : running.fetch(url, init),
    })
    await signIn(session)
    expect(await T.runPromise(session.logout)).toBe(REMOVED_ONLY_HERE)
  })

  it('stops waiting for an approval at logout', async () => {
    const session = sessionWith()
    const asked = await T.runPromise(session.login)
    await T.runPromise(session.logout)
    await running.decide(asked)
    expect(session.state().kind).toBe('signed_out')
  })

  it('tells a desk when it signs in and out, and adds what the desk does to the status', async () => {
    const told: string[] = []
    const session = sessionWith({
      desk: {
        signedIn: (token) => T.sync(() => void told.push(`in ${token.slice(0, 4)}`)),
        signedOut: T.sync(() => void told.push('out')),
        describe: () => 'The desk is answering.',
      },
    })
    expect(await T.runPromise(session.status)).toMatch(/Call login to sign in\. The desk is answering\.$/)
    await signIn(session)
    await T.runPromise(session.logout)
    expect(told).toEqual(['in hba_', 'out'])
  })

  it('names the side to upgrade when the server speaks a protocol it cannot read', async () => {
    const session = sessionWith({
      fetch: async (url, init) => {
        const answer = await running.fetch(url, init)
        if (!url.endsWith('/api/v1/info')) return answer
        return new Response(JSON.stringify({ ...((await answer.json()) as object), protocolVersion: 999 }), {
          status: 200,
        })
      },
    })
    expect(session.protocolProblem()).toBeNull()
    await signIn(session)
    await running.until(() => session.protocolProblem() !== null)
    expect(session.protocolProblem()).toBe(UPGRADE_SENTENCES.client)
    await T.runPromise(session.logout)
    expect(session.protocolProblem()).toBeNull()
  })

  it('reports the session online to a listener and hands it the events that arrive', async () => {
    const seen: string[] = []
    const session = sessionWith({
      listener: {
        online: T.sync(() => void seen.push('online')),
        received: (event) => T.sync(() => void seen.push(event.body.type)),
      },
    })
    await signIn(session)
    await running.until(() => seen.includes('online'))
    await running.owner.api('PATCH', '/me', { about: 'Release manager' })
    await running.until(() => seen.length > 1)
    expect(seen[0]).toBe('online')
  })
})

describe('makeLocalSession on a runner’s credential', () => {
  const runnerFile = () => join(dirname(running.credentialPath), 'runner-agent.json')

  const runnersToken = async (): Promise<string> => {
    const own = sessionWith()
    await signIn(own)
    return own.token()!
  }

  it('signs in with the runner’s credential file only, and never signs in or out itself', async () => {
    const token = await runnersToken()
    await writeFile(runnerFile(), JSON.stringify({ serverUrl: `${SERVER_URL}/`, token }))
    const before = await readFile(running.credentialPath, 'utf8')
    const session = sessionWith({ runnerCredentialPath: runnerFile() })
    await T.runPromise(session.restore)
    expect(session.state()).toEqual({ kind: 'signed_in' })
    expect(session.token()).toBe(token)
    expect(session.protocolProblem()).toBeNull()
    expect(await T.runPromise(session.status)).toMatch(/^Signed in to .* with the runner’s credential "/)
    expect(await T.runPromise(session.login)).toBe(RUNNERS_CREDENTIAL)
    expect(await T.runPromise(session.logout)).toBe(RUNNERS_CREDENTIAL)
    expect(session.token()).toBe(token)
    expect(await readFile(runnerFile(), 'utf8')).toContain(token)
    expect(await readFile(running.credentialPath, 'utf8')).toBe(before)
  })

  it('stays signed out on a missing file, or one for another server, and says so', async () => {
    const missing = sessionWith({ runnerCredentialPath: runnerFile() })
    await T.runPromise(missing.restore)
    expect(missing.state().kind).toBe('signed_out')
    expect(await T.runPromise(missing.status)).toContain('could not read the runner’s credential')
    await writeFile(runnerFile(), JSON.stringify({ serverUrl: 'https://other.example.com', token: 'hba_x' }))
    const other = sessionWith({ runnerCredentialPath: runnerFile() })
    await T.runPromise(other.restore)
    expect(other.token()).toBeNull()
    await writeFile(runnerFile(), '{"token":')
    const broken = sessionWith({ runnerCredentialPath: runnerFile() })
    await T.runPromise(broken.restore)
    expect(broken.token()).toBeNull()
  })

  it('stops using a credential the server refuses, and says to sign in again', async () => {
    await writeFile(
      runnerFile(),
      JSON.stringify({ serverUrl: SERVER_URL, token: 'hba_refused-token-000000000000' }),
    )
    const session = sessionWith({ runnerCredentialPath: runnerFile() })
    await T.runPromise(session.restore)
    expect(await T.runPromise(session.status)).toContain('no longer accepts the runner’s credential')
    expect(session.token()).toBeNull()
    await T.runPromise(session.restore)
    session.credentialWasRefused()
    expect(session.state().kind).toBe('signed_out')
  })
})
