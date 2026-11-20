import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AGENT_ERRORS_MAX_BYTES,
  AGENT_OUTPUT_MAX_BYTES,
  type Spawn,
  nodeLauncher,
  openerCommand,
  taskkillCommand,
} from '../src/node-launcher.ts'

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
      errors: '',
    })
    expect(
      await launcher.runAgent(`${NODE} -e "process.exit(3)"`, '', PATH_ONLY, new AbortController().signal),
    ).toEqual({
      exitCode: 3,
      output: '',
      errors: '',
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
    expect(ran).toEqual({ exitCode: 0, output: 'ok', errors: '' })
    expect(started).toEqual([{ command: 'codex exec', args: [], env: handed }])
  })

  it('keeps the agent’s own error output for the runner, and passes it on only outside the service', async () => {
    const start: Spawn = (_command, _args, options) => {
      expect((options.stdio as unknown[])[2]).toBe('pipe')
      const stderr = new EventEmitter()
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr,
        stdin: {
          on: () => {},
          end: () => {
            stderr.emit('data', Buffer.from('Error: refused\n'))
            stderr.emit('data', Buffer.alloc(AGENT_ERRORS_MAX_BYTES, 'x'))
            queueMicrotask(() => child.emit('close', 1))
          },
        },
      })
      return child as unknown as ChildProcess
    }
    const passedOn: string[] = []
    const write = (chunk: Buffer) => void passedOn.push(chunk.toString('utf8'))
    const shown = await nodeLauncher('linux', start, undefined, 'inherit', 'C:\\Windows', write).runAgent(
      'a',
      '',
      PATH_ONLY,
      new AbortController().signal,
    )
    expect(shown.errors).toBe('Error: refused\n')
    expect(passedOn).toHaveLength(2)
    const kept = await nodeLauncher('linux', start, undefined, 'ignore', 'C:\\Windows', write).runAgent(
      'a',
      '',
      PATH_ONLY,
      new AbortController().signal,
    )
    expect(kept.errors).toBe('Error: refused\n')
    expect(passedOn).toHaveLength(2)
  })

  it('on Windows, hides the command’s window and ends its whole process tree with taskkill when stopped', async () => {
    const started: Array<{ command: string; args: ReadonlyArray<string>; options: unknown }> = []
    const start: Spawn = (command, args, options) => {
      started.push({ command, args, options })
      const child = Object.assign(new EventEmitter(), {
        pid: 4242,
        stdout: new EventEmitter(),
        stdin: Object.assign(new EventEmitter(), { end: () => {} }),
      })
      return child as unknown as ChildProcess
    }
    const stopping = new AbortController()
    const running = nodeLauncher('win32', start, undefined, 'ignore', 'D:\\Windows').runAgent(
      'codex exec -',
      '',
      PATH_ONLY,
      stopping.signal,
    )
    stopping.abort()
    await expect(running).rejects.toThrow('The agent command was stopped.')
    expect(started[0]).toMatchObject({
      command: 'D:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', '"codex exec -"'],
      options: { shell: false, windowsHide: true, windowsVerbatimArguments: true },
    })
    expect(started[0]!.options).not.toHaveProperty('detached')
    expect(started[1]).toMatchObject({
      command: 'D:\\Windows\\System32\\taskkill.exe',
      args: ['/T', '/F', '/PID', '4242'],
      options: { windowsHide: true, shell: false },
    })
    expect(taskkillCommand('C:\\Windows', 7)).toEqual([
      'C:\\Windows\\System32\\taskkill.exe',
      ['/T', '/F', '/PID', '7'],
    ])
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

  it.skipIf(process.platform === 'win32')(
    'stops what the command started too, so nothing outlives the runner',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'homingbird-launcher-'))
      const pidFile = join(directory, 'pid')
      const stopping = new AbortController()
      const running = nodeLauncher(process.platform).runAgent(
        `sleep 30 & echo $! > ${pidFile}; wait`,
        '',
        PATH_ONLY,
        stopping.signal,
      )
      let pid = ''
      for (let turn = 0; turn < 200 && pid === ''; turn++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        pid = (await readFile(pidFile, 'utf8').catch(() => '')).trim()
      }
      expect(isAlive(Number(pid))).toBe(true)
      stopping.abort()
      await expect(running).rejects.toThrow('The agent command was stopped.')
      for (let turn = 0; turn < 200 && isAlive(Number(pid)); turn++)
        await new Promise((resolve) => setTimeout(resolve, 10))
      expect(isAlive(Number(pid))).toBe(false)
    },
  )

  it('signals the whole group, and falls back to the kill signal for a group that will not stop', async () => {
    const signals: Array<[number, string]> = []
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdout: new EventEmitter(),
      stdin: Object.assign(new EventEmitter(), { end: () => {} }),
    })
    const stopping = new AbortController()
    stopping.abort()
    const running = nodeLauncher(
      'linux',
      () => child as unknown as ChildProcess,
      (pid, signal) => {
        signals.push([pid, signal])
        throw new Error('no such process')
      },
    ).runAgent('codex exec', '', PATH_ONLY, stopping.signal)
    await expect(running).rejects.toThrow('The agent command was stopped.')
    expect(signals).toEqual([[-4242, 'SIGTERM']])
  })
})

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
