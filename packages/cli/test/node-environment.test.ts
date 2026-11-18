import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { systemClock } from '@homingbird/kernel'
import { wrapNote } from '@homingbird/protocol'
import { describe, expect, it, vi } from 'vitest'
import { nodeEnvironment } from '../src/node-environment.ts'

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

  it('reads a missing file as null and removes files without complaint', async () => {
    const { files } = nodeEnvironment(new AbortController().signal)
    const path = join(await mkdtemp(join(tmpdir(), 'homingbird-cli-')), 'nothing.json')
    expect(await files.read(path)).toBeNull()
    await files.remove(path)
    await files.writePrivate(path, 'x')
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
