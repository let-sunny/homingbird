import { chmod, link, mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Task as T, systemClock } from '@homingbird/kernel'
import { wrapNote } from '@homingbird/protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  LOG_FILE_MAX_BYTES,
  commandLineProgram,
  logFileOutput,
  nodeEnvironment,
} from '../src/node-environment.ts'

describe('nodeEnvironment', () => {
  it.skipIf(process.platform === 'win32')(
    'writes private files readable only by their owner, in a directory only the owner can enter',
    async () => {
      const { files } = nodeEnvironment(new AbortController().signal)
      const path = join(
        await mkdtemp(join(tmpdir(), 'homingbird-cli-')),
        'homingbird',
        'agent-credential.json',
      )
      await T.runPromise(files.writePrivate(path, 'first'))
      await T.runPromise(files.writePrivate(path, 'second'))
      expect(await T.runPromise(files.read(path))).toBe('second')
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'follows symbolic links to the real path, and tells a runnable file from a plain one or none',
    async () => {
      const { programs } = nodeEnvironment(new AbortController().signal)
      const directory = await mkdtemp(join(tmpdir(), 'homingbird-cli-'))
      const real = join(directory, 'agent')
      await writeFile(real, '#!/bin/sh\n')
      await chmod(real, 0o755)
      await writeFile(join(directory, 'notes.txt'), '')
      await symlink(real, join(directory, 'linked'))
      expect(await programs.realPath(join(directory, 'linked'))).toBe(await programs.realPath(real))
      expect(await programs.realPath(join(directory, 'missing'))).toBeNull()
      expect(await programs.isRunnable(join(directory, 'linked'))).toBe(true)
      expect(await programs.isRunnable(join(directory, 'notes.txt'))).toBe(false)
      expect(await programs.isRunnable(directory)).toBe(false)
      expect(await programs.isRunnable(join(directory, 'missing'))).toBe(false)
    },
  )

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

  it('runs a program with exactly the environment it is given, and stops it when asked', async () => {
    const { processes } = nodeEnvironment(new AbortController().signal)
    const printed = await processes.run(
      process.execPath,
      [
        '-e',
        'process.stdout.write(Object.keys(process.env).filter((name) => name.startsWith("HB_PROBE")).join(","))',
      ],
      { environment: { HB_PROBE_ONLY: '1', SystemRoot: process.env.SystemRoot ?? '' } },
    )
    expect(printed).toEqual({ exitCode: 0, output: 'HB_PROBE_ONLY' })
    const stopping = new AbortController()
    const waiting = processes.run(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      signal: stopping.signal,
      timeoutMs: 60_000,
    })
    stopping.abort()
    expect((await waiting).exitCode).toBeNull()
  })

  it.skipIf(process.platform === 'win32')(
    'writes a service file only its owner can read, leaving the mode of a directory it shares alone',
    async () => {
      const { files } = nodeEnvironment(new AbortController().signal)
      const shared = join(await mkdtemp(join(tmpdir(), 'homingbird-cli-')), 'LaunchAgents')
      await mkdir(shared)
      await chmod(shared, 0o755)
      await T.runPromise(files.writeOwnerOnly(join(shared, 'a.plist'), 'plist'))
      expect((await stat(shared)).mode & 0o777).toBe(0o755)
      expect((await stat(join(shared, 'a.plist'))).mode & 0o777).toBe(0o600)
      const created = join(shared, 'new', 'b.xml')
      await T.runPromise(files.writeOwnerOnly(created, '<x/>'))
      expect(await readFile(created, 'utf8')).toBe('<x/>')
      expect((await stat(join(created, '..'))).mode & 0o777).toBe(0o700)
    },
  )

  it('saves only the Node executable and the script for a service, never options such as --inspect', () => {
    expect(
      commandLineProgram('/usr/bin/node', ['/usr/bin/node', '/usr/lib/homingbird.js', 'service']),
    ).toEqual(['/usr/bin/node', '/usr/lib/homingbird.js'])
    expect(commandLineProgram('/usr/bin/node', ['/usr/bin/node'])).toEqual(['/usr/bin/node'])
    const { program } = nodeEnvironment(new AbortController().signal)
    expect(program).toEqual([process.execPath, process.argv[1]])
  })

  it.skipIf(process.platform === 'win32')(
    'appends each line to a private log file when the service writes its own log',
    async () => {
      const path = join(await mkdtemp(join(tmpdir(), 'homingbird-cli-')), 'logs', 'runner.log')
      const output = logFileOutput(path)
      output.line('first')
      output.problem('second')
      expect(await readFile(path, 'utf8')).toBe('first\nsecond\n')
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect(nodeEnvironment(new AbortController().signal, { logFile: path }).output.line).not.toBe(
        nodeEnvironment(new AbortController().signal).output.line,
      )
    },
  )

  it('keeps one backup when the log grows past its limit, so a looping service cannot fill a disk', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'homingbird-cli-')), 'logs', 'runner.log')
    const output = logFileOutput(path, 12)
    output.line('first line')
    output.line('second line')
    output.line('third line')
    expect(await readFile(path, 'utf8')).toBe('third line\n')
    expect(await readFile(`${path}.1`, 'utf8')).toBe('first line\nsecond line\n')
    expect(LOG_FILE_MAX_BYTES).toBe(5 * 1024 * 1024)
  })

  it.skipIf(process.platform === 'win32')(
    'tells the permission bits of a file through its links, and none for a missing one',
    async () => {
      const { files } = nodeEnvironment(new AbortController().signal)
      const directory = await mkdtemp(join(tmpdir(), 'homingbird-cli-'))
      const secret = join(directory, 'secret.json')
      await writeFile(secret, '{}')
      await chmod(secret, 0o644)
      await symlink(secret, join(directory, 'linked.json'))
      expect(await T.runPromise(files.mode(join(directory, 'linked.json')))).toBe(0o644)
      expect(await T.runPromise(files.mode(join(directory, 'missing.json')))).toBeNull()
      expect(await T.runPromise(files.isWritable(secret))).toBe(true)
      expect(await T.runPromise(files.isWritable(join(directory, 'missing.json')))).toBe(false)
    },
  )

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'tells whether this user may change a file and remove it from its directory',
    async () => {
      const { files } = nodeEnvironment(new AbortController().signal)
      const directory = await mkdtemp(join(tmpdir(), 'homingbird-cli-'))
      const secret = join(directory, 'secret.json')
      await writeFile(secret, '{}')
      expect(await T.runPromise(files.isWritable(secret))).toBe(true)
      await chmod(secret, 0o400)
      expect(await T.runPromise(files.isWritable(secret))).toBe(false)
      const mounted = join(directory, 'mounted')
      await mkdir(mounted)
      await writeFile(join(mounted, 'secret.json'), '{}')
      await chmod(mounted, 0o500)
      expect(await T.runPromise(files.isWritable(join(mounted, 'secret.json')))).toBe(false)
      await chmod(mounted, 0o700)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'creates a credentials file readable by its owner only, and never replaces one that exists',
    async () => {
      const { files } = nodeEnvironment(new AbortController().signal)
      const path = join(await mkdtemp(join(tmpdir(), 'homingbird-cli-')), 'homingbird.json')
      expect(await T.runPromise(files.createExclusive(path, 'first'))).toBe(true)
      expect(await T.runPromise(files.createExclusive(path, 'second'))).toBe(false)
      expect(await T.runPromise(files.read(path))).toBe('first')
      expect(await T.runPromise(files.mode(path))).toBe(0o600)
      await chmod(path, 0o644)
      await T.runPromise(files.writeOwnerOnly(path, 'third'))
      expect(await T.runPromise(files.mode(path))).toBe(0o600)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'replaces a file with --force by renaming a new owner-only file over it, never writing into the old one',
    async () => {
      const { files } = nodeEnvironment(new AbortController().signal)
      const directory = await mkdtemp(join(tmpdir(), 'homingbird-cli-'))
      const path = join(directory, 'homingbird.json')
      await writeFile(path, 'old')
      await chmod(path, 0o644)
      const kept = join(directory, 'kept.json')
      await link(path, kept)
      const before = (await stat(path)).ino
      await T.runPromise(files.writeOwnerOnly(path, 'hba_token'))
      expect([await readFile(path, 'utf8'), (await stat(path)).mode & 0o777]).toEqual(['hba_token', 0o600])
      expect((await stat(path)).ino).not.toBe(before)
      expect(await readFile(kept, 'utf8')).toBe('old')
      expect((await readdir(directory)).sort()).toEqual(['homingbird.json', 'kept.json'])
    },
  )

  it('reads a missing file as null and removes files without complaint', async () => {
    const { files } = nodeEnvironment(new AbortController().signal)
    const path = join(await mkdtemp(join(tmpdir(), 'homingbird-cli-')), 'nothing.json')
    expect(await T.runPromise(files.read(path))).toBeNull()
    expect(await T.runPromise(files.exists(path))).toBe(false)
    await T.runPromise(files.remove(path))
    await T.runPromise(files.writePrivate(path, 'x'))
    expect(await T.runPromise(files.exists(path))).toBe(true)
    await T.runPromise(files.remove(path))
    expect(await T.runPromise(files.read(path))).toBeNull()
  })

  it('creates a file only when none is there, and fails on anything but an existing file', async () => {
    const { files } = nodeEnvironment(new AbortController().signal)
    const directory = await mkdtemp(join(tmpdir(), 'homingbird-cli-'))
    const path = join(directory, 'claims', 'desk.json')
    expect(await T.runPromise(files.createExclusive(path, 'first'))).toBe(true)
    expect(await T.runPromise(files.createExclusive(path, 'second'))).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('first')
    await expect(T.runPromise(files.createExclusive(join(directory, 'x'.repeat(300)), 'x'))).rejects.toThrow()
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
