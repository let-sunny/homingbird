import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/failure.ts'
import { agentEnvironment, requireNoApprovalCredential } from '../src/runner-guard.ts'
import { AGENT_TOKEN, APPROVAL_FILE, HOME, world } from './support.ts'

describe('agentEnvironment', () => {
  it('drops Homingbird and Dovecote variables in any letter case, and anything holding a withheld secret', () => {
    expect(
      agentEnvironment(
        {
          PATH: '/usr/bin',
          LANG: 'C',
          UNSET: undefined,
          HOMINGBIRD_SERVER: 'https://hb.example.com',
          Homingbird_Anything: 'x',
          HB_DATABASE_URL: 'postgres://secret',
          COPIED: `token=${AGENT_TOKEN}`,
          HBX_KEEP: 'kept',
        },
        [AGENT_TOKEN, ''],
      ),
    ).toEqual({ PATH: '/usr/bin', LANG: 'C', HBX_KEEP: 'kept' })
  })
})

describe('requireNoApprovalCredential', () => {
  const check = async (w: ReturnType<typeof world>) => T.run(requireNoApprovalCredential, w.env)

  it('passes when no approve-button credential is stored where the agent could look', async () => {
    expect((await check(world({ signedIn: 'agent' })))._tag).toBe('Ok')
  })

  it('fails with the unsafe exit code and names the file, without reading it', async () => {
    const w = world({ signedIn: 'both' })
    const exit = await check(w)
    expect(exit).toMatchObject({ _tag: 'Err', error: { _tag: 'Fail', error: { exitCode: EXIT.unsafe } } })
    expect(JSON.stringify(exit)).toContain(APPROVAL_FILE)
    expect(w.reads).toEqual([])
  })

  it('looks in the configured directory and in the default one', async () => {
    const w = world({ signedIn: 'none', variables: { XDG_CONFIG_HOME: `${HOME}/elsewhere` } })
    w.files.set(`${HOME}/elsewhere/homingbird/approval-credential.json`, '{}')
    expect(JSON.stringify(await check(w))).toContain(`${HOME}/elsewhere/homingbird/approval-credential.json`)
  })
})
