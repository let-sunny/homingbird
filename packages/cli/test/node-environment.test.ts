import { chmod, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { systemClock } from '@homingbird/kernel'
import { wrapNote } from '@homingbird/protocol'
import { describe, expect, it, vi } from 'vitest'
import { commandLineProgram, logFileOutput, nodeEnvironment } from '../src/node-environment.ts'

describe('nodeEnvironment', () => {
  it('writes private files readable only by their owner, in a directory only the owner can enter', async () => {
    const { files } = nodeEnvironment(new AbortController().signal)
    const path = join(await mkdtemp(join(tmpdir(), 'homingbird-cli-')), 'homingbird', 'agent-credential.json')
    await files.writePrivate(path, 'first')
    await files.writePrivate(path, 'second')
    expect(await files.read(path)).toBe('second')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700)
  })

  it('runs a program without a shell and collects both of its outputs and its exit code', async () => {
    const { processes, program, platform } = nodeEnvironment(new AbortController().signal)
    expect(
      await processes.run(process.execPath, [
        '-e',
        'process.stdout.write("out;"); process.stderr.write("$HOME")',
      ]),
    ).toEqual({ exitCode: 0, output: 'out;$HOME' })
    expect(await processes.run(process.execPath, ['-e', 'process.exit(4)'])).toEqual({
      exitCode: 4,
      output: '',
    })
    const missing = await processes.run('/nonexistent/systemctl', [])
    expect(missing.exitCode).toBeNull()
    expect(missing.output).toContain('ENOENT')
    expect(program[0]).toBe(process.execPath)
    expect(platform).toBe(process.platform)
  })

  it('writes a service file only its owner can read, leaving the mode of a directory it shares alone', async () => {
    const { files } = nodeEnvironment(new AbortController().signal)
    const shared = join(await mkdtemp(join(tmpdir(), 'homingbird-cli-')), 'LaunchAgents')
    await mkdir(shared)
    await chmod(shared, 0o755)
    await files.writeOwnerOnly(join(shared, 'a.plist'), 'plist')
    expect((await stat(shared)).mode & 0o777).toBe(0o755)
    expect((await stat(join(shared, 'a.plist'))).mode & 0o777).toBe(0o600)
    const created = join(shared, 'new', 'b.xml')
    await files.writeOwnerOnly(created, '<x/>')
    expect(await readFile(created, 'utf8')).toBe('<x/>')
    expect((await stat(join(created, '..'))).mode & 0o777).toBe(0o700)
  })

  it('saves only the Node executable and the script for a service, never options such as --inspect', () => {
    expect(
      commandLineProgram('/usr/bin/node', ['/usr/bin/node', '/usr/lib/homingbird.js', 'service']),
    ).toEqual(['/usr/bin/node', '/usr/lib/homingbird.js'])
    expect(commandLineProgram('/usr/bin/node', ['/usr/bin/node'])).toEqual(['/usr/bin/node'])
    const { program } = nodeEnvironment(new AbortController().signal)
    expect(program).toEqual([process.execPath, process.argv[1]])
  })

  it('appends each line to a private log file when the service writes its own log', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'homingbird-cli-')), 'logs', 'runner.log')
    const output = logFileOutput(path)
    output.line('first')
    output.problem('second')
    expect(await readFile(path, 'utf8')).toBe('first\nsecond\n')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(nodeEnvironment(new AbortController().signal, { logFile: path }).output.line).not.toBe(
      nodeEnvironment(new AbortController().signal).output.line,
    )
  })

  it('reads a missing file as null and removes files without complaint', async () => {
    const { files } = nodeEnvironment(new AbortController().signal)
    const path = join(await mkdtemp(join(tmpdir(), 'homingbird-cli-')), 'nothing.json')
    expect(await files.read(path)).toBeNull()
    expect(await files.exists(path)).toBe(false)
    await files.remove(path)
    await files.writePrivate(path, 'x')
    expect(await files.exists(path)).toBe(true)
    await files.remove(path)
    expect(await files.read(path)).toBeNull()
  })

  it('writes results to stdout and problems to stderr, one line each', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const { output } = nodeEnvironment(new AbortController().signal)
    output.line('result')
    output.problem('trouble')
    expect(out).toHaveBeenCalledWith('result\n')
    expect(err).toHaveBeenCalledWith('trouble\n')
    out.mockRestore()
    err.mockRestore()
  })

  it('supplies the real clock, the stop signal, and a nonce the note wrapper accepts', () => {
    const stopped = new AbortController().signal
    const env = nodeEnvironment(stopped)
    expect(env.clock).toBe(systemClock)
    expect(env.stopped).toBe(stopped)
    expect(env.fetch).toBe(globalThis.fetch)
    expect(env.homeDirectory.length).toBeGreaterThan(0)
    expect(env.hostName.length).toBeGreaterThan(0)
    expect(env.nonce()).not.toBe(env.nonce())
    expect(() =>
      wrapNote({
        noteId: 'n',
        authorName: 'a',
        authorEmail: 'b',
        sentAt: null,
        body: 'c',
        nonce: env.nonce(),
      }),
    ).not.toThrow()
  })
})
