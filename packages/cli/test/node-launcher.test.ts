import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { AGENT_OUTPUT_MAX_BYTES, type Spawn, nodeLauncher, openerCommand } from '../src/node-launcher.ts'

const NODE = JSON.stringify(process.execPath)
const PATH_ONLY = { PATH: process.env.PATH ?? '' }

const fakeOpener = (outcome: 'spawn' | 'error') => {
  const started: Array<{ command: string; args: ReadonlyArray<string>; shell: unknown }> = []
  const start: Spawn = (command, args, options) => {
    started.push({ command, args, shell: options.shell })
    const child = Object.assign(new EventEmitter(), { unref: () => {} })
    queueMicrotask(() => child.emit(outcome, new Error('no opener')))
    return child as unknown as ChildProcess
  }
  return { started, start }
}

describe('openerCommand', () => {
  it('uses the opener of each platform, with the address as one argument', () => {
    expect(openerCommand('darwin', 'https://hb.example.com/')).toEqual(['open', 'https://hb.example.com/'])
    expect(openerCommand('win32', 'https://hb.example.com/')).toEqual([
      'rundll32',
      'url.dll,FileProtocolHandler',
      'https://hb.example.com/',
    ])
    expect(openerCommand('linux', 'https://hb.example.com/')).toEqual(['xdg-open', 'https://hb.example.com/'])
  })
})

describe('nodeLauncher', () => {
  it('opens a web address with the platform opener, without a shell', async () => {
    const opener = fakeOpener('spawn')
    expect(await nodeLauncher('linux', opener.start).openInBrowser('https://hb.example.com/#/c/conv_1')).toBe(
      true,
    )
    expect(opener.started).toEqual([
      { command: 'xdg-open', args: ['https://hb.example.com/#/c/conv_1'], shell: false },
    ])
  })

  it('says it did not open when the opener is missing, and never opens anything but a web address', async () => {
    expect(
      await nodeLauncher('linux', fakeOpener('error').start).openInBrowser('https://hb.example.com/'),
    ).toBe(false)
    const opener = fakeOpener('spawn')
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url'])
      expect(await nodeLauncher('linux', opener.start).openInBrowser(url)).toBe(false)
    expect(opener.started).toEqual([])
  })

  it('runs the agent command with the prompt on stdin and returns what it printed', async () => {
    const launcher = nodeLauncher(process.platform)
    const echo = `${NODE} -e "process.stdin.pipe(process.stdout)"`
    expect(
      await launcher.runAgent(echo, 'Draft a reply.\nThanks', PATH_ONLY, new AbortController().signal),
    ).toEqual({
      exitCode: 0,
      output: 'Draft a reply.\nThanks',
    })
    expect(
      await launcher.runAgent(`${NODE} -e "process.exit(3)"`, '', PATH_ONLY, new AbortController().signal),
    ).toEqual({
      exitCode: 3,
      output: '',
    })
  })

  it('starts the agent command with exactly the environment it is given, and nothing on its command line', async () => {
    const started: Array<{ command: string; args: ReadonlyArray<string>; env: unknown }> = []
    const start: Spawn = (command, args, options) => {
      started.push({ command, args, env: options.env })
      const stdout = new EventEmitter()
      const child = Object.assign(new EventEmitter(), {
        stdout,
        stdin: {
          on: () => {},
          end: () => {
            stdout.emit('data', Buffer.from('ok'))
            queueMicrotask(() => child.emit('close', 0))
          },
        },
      })
      return child as unknown as ChildProcess
    }
    const handed = { PATH: '/usr/bin', LANG: 'C' }
    const ran = await nodeLauncher('linux', start).runAgent(
      'codex exec',
      'Draft.',
      handed,
      new AbortController().signal,
    )
    expect(ran).toEqual({ exitCode: 0, output: 'ok' })
    expect(started).toEqual([{ command: 'codex exec', args: [], env: handed }])
  })

  it('keeps at most a bounded amount of output', async () => {
    const flood = `${NODE} -e "process.stdout.write('x'.repeat(${AGENT_OUTPUT_MAX_BYTES * 2}))"`
    const { output } = await nodeLauncher(process.platform).runAgent(
      flood,
      '',
      PATH_ONLY,
      new AbortController().signal,
    )
    expect(output.length).toBeLessThanOrEqual(AGENT_OUTPUT_MAX_BYTES)
  })

  it('stops the command when it is interrupted', async () => {
    const stopping = new AbortController()
    const running = nodeLauncher(process.platform).runAgent(
      `${NODE} -e "setInterval(() => {}, 1000)"`,
      '',
      PATH_ONLY,
      stopping.signal,
    )
    stopping.abort()
    await expect(running).rejects.toThrow()
  })
})
