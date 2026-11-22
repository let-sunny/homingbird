import { describe, expect, it } from 'vitest'
import { COMMAND_NAMES, DOVECOTE_USAGE, invocationOf } from '../src/invocation.ts'
import { SERVER_VERSION } from '../src/version.ts'

describe('what dovecote is asked to do', () => {
  it('serves with no arguments, or with serve alone', () => {
    expect(invocationOf([])).toEqual({ kind: 'serve' })
    expect(invocationOf(['serve'])).toEqual({ kind: 'serve' })
  })

  it('runs each known command with the arguments after it', () => {
    for (const command of COMMAND_NAMES)
      expect(invocationOf([command, 'verify', 'x'])).toEqual({
        kind: 'command',
        command,
        args: ['verify', 'x'],
      })
  })

  it('prints the usage for --help and its version for --version, and exits 0', () => {
    for (const help of ['--help', '-h', 'help'])
      expect(invocationOf([help])).toEqual({ kind: 'print', text: DOVECOTE_USAGE, exitCode: 0 })
    expect(invocationOf(['--version'])).toEqual({
      kind: 'print',
      text: `dovecote ${SERVER_VERSION}`,
      exitCode: 0,
    })
  })

  it('never starts a server for a word it does not know: it names it, prints the usage and exits 2', () => {
    for (const args of [['adit', 'verify'], ['toString'], ['--port', '9000'], ['serve', 'now']]) {
      const asked = invocationOf(args)
      expect(asked).toMatchObject({ kind: 'print', exitCode: 2 })
      expect(asked.kind === 'print' && asked.text.endsWith(DOVECOTE_USAGE)).toBe(true)
    }
    expect(invocationOf(['adit'])).toMatchObject({
      text: expect.stringMatching(/^dovecote has no command "adit"\./),
    })
    expect(invocationOf(['serve', 'now'])).toMatchObject({
      text: expect.stringMatching(/^`dovecote serve` takes no arguments\./),
    })
  })

  it('lists every command it runs in its usage', () => {
    for (const command of COMMAND_NAMES) expect(DOVECOTE_USAGE).toContain(`dovecote ${command} `)
  })
})
