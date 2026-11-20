import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { presetNamed } from '../src/agent-presets.ts'
import { presetVersion, tooOldProblem, versionIn, versionLine } from '../src/agent-version.ts'
import { type WorldOptions, world } from './support.ts'

const claude = presetNamed('claude')!
const codex = presetNamed('codex')!

const checked = async (preset = claude, process: WorldOptions['process'] = undefined) => {
  const w = world({ signedIn: 'none', ...(process !== undefined && { process }) })
  const exit = await T.run(presetVersion(preset), w.env)
  return exit._tag === 'Ok' ? exit.value : null
}

describe('presetVersion', () => {
  it('reads the version a program prints, and compares it with the oldest the preset works with', async () => {
    expect(await checked(claude, () => ({ exitCode: 0, output: '2.1.329 (Claude Code)' }))).toEqual({
      status: 'supported',
      version: '2.1.329',
    })
    expect(await checked(claude, () => ({ exitCode: 0, output: '2.1.259' }))).toMatchObject({
      status: 'supported',
    })
    expect(await checked(claude, () => ({ exitCode: 0, output: '2.1.258' }))).toMatchObject({
      status: 'too_old',
    })
    expect(await checked(claude, () => ({ exitCode: 0, output: '1.9.999' }))).toMatchObject({
      status: 'too_old',
    })
    expect(await checked(codex, () => ({ exitCode: 0, output: 'codex-cli 0.1.0' }))).toMatchObject({
      status: 'supported',
    })
  })

  it('tells a program that is not there from one whose version it cannot read', async () => {
    expect(await checked(claude, () => ({ exitCode: null, output: '' }))).toEqual({
      status: 'missing',
      version: null,
    })
    expect(
      await checked(claude, () => {
        throw new Error('ENOENT')
      }),
    ).toEqual({ status: 'missing', version: null })
    expect(await checked(claude, () => ({ exitCode: 1, output: '2.1.329' }))).toEqual({
      status: 'unknown',
      version: null,
    })
  })
})

describe('versionLine and tooOldProblem', () => {
  it('say what is installed, what is needed and how to upgrade', () => {
    expect(versionLine(claude, { status: 'missing', version: null })).toBe(
      'not found on this PATH, needs 2.1.259 or later',
    )
    expect(versionLine(codex, { status: 'unknown', version: null })).toBe('installed, version not readable')
    expect(versionLine(claude, { status: 'too_old', version: '2.0.1' })).toBe(
      '2.0.1, too old, needs 2.1.259 or later: claude update',
    )
    expect(tooOldProblem(claude, { status: 'supported', version: '2.1.329' })).toBeNull()
  })
})

describe('versionIn', () => {
  it('finds the first three-part version number', () => {
    expect(versionIn('codex-cli 0.46.0\n')).toBe('0.46.0')
    expect(versionIn('agy version 1.2.11 (build 4)')).toBe('1.2.11')
    expect(versionIn('v12')).toBeNull()
  })
})
