import { describe, expect, it } from 'vitest'
import { USAGE } from '../src/arguments.ts'
import { EXIT } from '../src/failure.ts'
import { CLI_VERSION } from '../src/version.ts'
import { DRAFT } from './command-fixtures.ts'
import { AGENT_TOKEN, SERVER, world } from './support.ts'

describe('version', () => {
  it('prints the version for --version and -v, without calling the server', async () => {
    for (const flag of ['--version', '-v']) {
      const w = world()
      expect(await w.run(flag)).toBe(0)
      expect(w.lines).toEqual([`homingbird ${CLI_VERSION}`])
      expect(w.calls).toEqual([])
    }
    const asJson = world()
    await asJson.run('--version', '--json')
    expect(asJson.json()).toEqual({ version: CLI_VERSION })
  })
})

describe('help', () => {
  it('prints usage for no command, and as JSON when asked', async () => {
    const plain = world()
    expect(await plain.run()).toBe(0)
    expect(plain.lines).toEqual([USAGE])
    const asJson = world()
    await asJson.run('help', '--json')
    expect(asJson.json()).toEqual({ usage: USAGE })
    expect(plain.calls).toEqual([])
  })

  it('reports a usage error on stderr with exit code 2, as JSON when asked', async () => {
    const plain = world()
    expect(await plain.run('fly')).toBe(EXIT.usage)
    expect(plain.lines).toEqual([])
    expect(plain.problems[0]).toMatch(/Unknown command "fly"/)
    const asJson = world()
    expect(await asJson.run('fly', '--json')).toBe(EXIT.usage)
    expect(JSON.parse(asJson.problems[0]!).error).toMatch(/Unknown command "fly"/)
  })
})

describe('approving', () => {
  it.each(['approve', 'discard'])(
    'has no %s command: approval happens only in the web client',
    async (command) => {
      const w = world()
      expect(await w.run(command, DRAFT.id)).toBe(EXIT.usage)
      expect(w.problems[0]).toMatch(new RegExp(`Unknown command "${command}"`))
      expect(w.calls).toEqual([])
    },
  )
})

describe('server and credentials file', () => {
  it('uses HOMINGBIRD_SERVER without its trailing slashes when --server is not given', async () => {
    const w = world({ signedIn: 'none', variables: { HOMINGBIRD_SERVER: ' https://other.example.com// ' } })
    expect(await w.run('inbox')).toBe(EXIT.signedOut)
    expect(w.problems).toEqual([
      'Not signed in to https://other.example.com. Run `homingbird login --server https://other.example.com` first.',
    ])
    const flagged = world({ signedIn: 'none', variables: { HOMINGBIRD_SERVER: 'https://other.example.com' } })
    await flagged.run('inbox', '--server', 'https://third.example.com')
    expect(flagged.problems[0]).toMatch(/^Not signed in to https:\/\/third\.example\.com\./)
  })

  it('reads the credential from HOMINGBIRD_CREDENTIALS_FILE, and from --credentials-file over it', async () => {
    const credential = JSON.stringify({ serverUrl: SERVER, token: AGENT_TOKEN })
    const files = { '/run/secrets/a.json': credential, '/run/secrets/b.json': credential }
    const variables = { HOMINGBIRD_CREDENTIALS_FILE: ' /run/secrets/a.json ' }
    const w = world({ signedIn: 'none', files, variables })
    await w.run('drafts')
    expect(w.reads).toContain('/run/secrets/a.json')
    const flagged = world({ signedIn: 'none', files, variables })
    await flagged.run('drafts', '--credentials-file', '/run/secrets/b.json')
    expect(flagged.reads).toContain('/run/secrets/b.json')
    expect(flagged.reads).not.toContain('/run/secrets/a.json')
  })

  it('ignores blank variables, as if they were not set', async () => {
    const w = world({ variables: { HOMINGBIRD_SERVER: '  ', HOMINGBIRD_CREDENTIALS_FILE: '' } })
    expect(await w.run('drafts')).not.toBe(EXIT.signedOut)
    expect(w.reads.some((path) => path.endsWith('.json'))).toBe(true)
  })
})

describe('failures', () => {
  it('prints a failed command’s message on stderr, as JSON when asked, and exits with its code', async () => {
    const plain = world({ signedIn: 'none' })
    expect(await plain.run('drafts')).toBe(EXIT.signedOut)
    expect(plain.lines).toEqual([])
    expect(plain.problems).toEqual([expect.stringMatching(/^Not signed in\./)])
    const asJson = world({ signedIn: 'none' })
    expect(await asJson.run('drafts', '--json')).toBe(EXIT.signedOut)
    expect(JSON.parse(asJson.problems[0]!)).toEqual({ error: expect.stringMatching(/^Not signed in\./) })
  })
})
