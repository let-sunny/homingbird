import { describe, expect, it } from 'vitest'
import { parseArguments } from '../src/arguments.ts'
import { RESPAWNED, respawnFor } from '../src/service-respawn.ts'

const invocation = (...argv: string[]) => {
  const parsed = parseArguments(argv, 'win32')
  if (parsed._tag === 'Err') throw new Error(parsed.error.message)
  return parsed.value.invocation
}

const SERVICE = invocation('run', '--service', '--server', 'https://hb.example.com', '--agent', 'claude')

describe('starting the service on Windows', () => {
  it('starts itself again detached and hidden, marked so that the copy runs', () => {
    expect(respawnFor('win32', SERVICE, { PATH: 'C:\\bin' })).toEqual({
      options: { detached: true, windowsHide: true, stdio: 'ignore' },
      environment: { PATH: 'C:\\bin', [RESPAWNED]: '1' },
    })
  })

  it('runs in place once marked, on other platforms, and for every other command', () => {
    expect(respawnFor('win32', SERVICE, { [RESPAWNED]: '1' })).toBeNull()
    expect(respawnFor('linux', SERVICE, {})).toBeNull()
    expect(respawnFor('darwin', SERVICE, {})).toBeNull()
    expect(respawnFor('win32', invocation('run', '--agent', 'claude'), {})).toBeNull()
    expect(respawnFor('win32', invocation('status'), {})).toBeNull()
    expect(respawnFor('win32', null, {})).toBeNull()
  })

  it('uses a variable the runner keeps from agent commands', () => {
    expect(RESPAWNED).toMatch(/^HOMINGBIRD_/)
  })
})
