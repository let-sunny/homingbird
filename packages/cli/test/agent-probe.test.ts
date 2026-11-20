import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { presetNamed } from '../src/agent-presets.ts'
import { presetAsked } from '../src/agent-probe.ts'
import type { ProcessOptions } from '../src/environment.ts'
import { world } from './support.ts'

const codex = presetNamed('codex')!
const antigravity = presetNamed('antigravity')!

const recording = () => {
  const runs: Array<{ program: string; args: ReadonlyArray<string>; options: ProcessOptions }> = []
  return {
    runs,
    process: async (program: string, args: ReadonlyArray<string>, options: ProcessOptions = {}) => {
      runs.push({ program, args, options })
      return { exitCode: 0, output: '1.0.0' }
    },
  }
}

describe('presetAsked', () => {
  it('runs with the environment an agent command gets, never the runner’s or a parent session’s', async () => {
    const { runs, process } = recording()
    const w = world({
      variables: {
        PATH: '/usr/bin',
        HOME: '/home/june',
        HOMINGBIRD_SERVER: 'https://hb.example.com',
        CLAUDECODE: '1',
        CODEX_THREAD_ID: 'thread',
      },
    })
    const env = { ...w.env, processes: { run: process } }
    expect(await T.runPromise(presetAsked(antigravity, ['--version'], 5_000), env)).toEqual({
      exitCode: 0,
      output: '1.0.0',
    })
    expect(runs[0]!.options).toMatchObject({
      timeoutMs: 5_000,
      environment: { PATH: '/usr/bin', HOME: '/home/june', AGY_CLI_DISABLE_AUTO_UPDATE: 'true' },
    })
    expect(Object.keys(runs[0]!.options.environment!).sort()).toEqual([
      'AGY_CLI_DISABLE_AUTO_UPDATE',
      'HOME',
      'PATH',
    ])
  })

  it('on Windows, finds npm’s codex.cmd on the PATH with the installers’ folders and runs it through cmd.exe', async () => {
    const { runs, process } = recording()
    const shim = 'C:\\Users\\june\\AppData\\Roaming\\npm\\codex.cmd'
    const w = world({
      platform: 'win32',
      variables: {
        Path: 'C:\\Windows\\System32',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        USERPROFILE: 'C:\\Users\\june',
        SystemRoot: 'D:\\Windows',
      },
      runnable: (path) => path === shim,
    })
    const env = { ...w.env, processes: { run: process } }
    await T.runPromise(presetAsked(codex, ['mcp', 'list', '--json'], 15_000), env)
    expect(runs[0]).toMatchObject({
      program: 'D:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', `""${shim}" mcp list --json"`],
      options: { windowsVerbatimArguments: true },
    })
    expect(runs[0]!.options.environment!.Path).toContain('C:\\Users\\june\\.local\\bin')
  })

  it('stops the program when the runner is interrupted, and takes it for one that printed nothing', async () => {
    let seen: AbortSignal | undefined
    const w = world({})
    const env = {
      ...w.env,
      processes: {
        run: (_program: string, _args: ReadonlyArray<string>, options: ProcessOptions = {}) => {
          seen = options.signal
          return new Promise<never>((_, reject) =>
            options.signal?.addEventListener('abort', () => reject(new Error('stopped'))),
          )
        },
      },
    }
    const stopping = new AbortController()
    const asked = T.run(presetAsked(codex, ['--version'], 5_000), env, stopping.signal)
    await new Promise((resolve) => setTimeout(resolve, 0))
    stopping.abort()
    await asked
    expect(seen?.aborted).toBe(true)
  })

  it('takes a program that throws for one that printed nothing', async () => {
    const w = world({ process: () => Promise.reject(new Error('ENOENT')) })
    expect(await T.runPromise(presetAsked(codex, ['--version'], 5_000), w.env)).toEqual({
      exitCode: null,
      output: '',
    })
  })
})
