import { describe, expect, it } from 'vitest'
import { defaultReader } from '../src/agent-presets.ts'
import { world } from './support.ts'

describe('homingbird presets', () => {
  it('lists each preset with its commands, its reader’s tools and how far it is verified', async () => {
    const w = world({ signedIn: 'none' })
    expect(await w.run('presets')).toBe(0)
    const text = w.lines[0]!
    expect(text).toContain('claude  Claude Code; verified with Claude Code 2.1.327')
    expect(text).toContain('codex  Codex CLI; not yet tested with the real CLI')
    expect(text).toContain('antigravity  Antigravity CLI (agy); not yet tested with the real CLI')
    expect(text).toContain('gemini  Gemini CLI, legacy')
    expect(text).toContain(`reader:  ${defaultReader('claude', 'linux')}  (no tools)`)
    expect(text).toMatch(/reader: {2}codex exec .* {2}\(minimal tools, not none\)/)
    expect(text).toContain('reader:  none known; with --split, give --reader yourself')
    expect(text).toContain('    account: Google’s terms bar other tools from using an Antigravity sign-in')
    expect(text.match(/ {4}account: /g)).toHaveLength(2)
    await w.run('presets', '--json')
    const listed = w.json().presets
    expect(listed.map((preset: { name: string }) => preset.name)).toEqual([
      'claude',
      'codex',
      'antigravity',
      'gemini',
    ])
    expect(listed[1]).toMatchObject({ readerTools: 'minimal', state: 'not yet tested with the real CLI' })
    expect(text).toContain('here:    installed, version not readable, needs 2.1.259 or later')
    expect(w.processRuns.slice(0, 4).map(([program, flag]) => `${program} ${flag}`)).toEqual([
      'claude --version',
      'codex --version',
      'agy --version',
      'gemini --version',
    ])
    expect(listed[0]).toMatchObject({ minimumVersion: '2.1.259', installed: { status: 'unknown' } })
    expect(listed[0].accountRisk).toBeNull()
    expect(listed[3].accountRisk).toContain('API key or Vertex AI')
    expect(w.calls).toEqual([])
  })

  it('shows the Windows form of the Claude Code reader on Windows', async () => {
    const w = world({ signedIn: 'none', platform: 'win32' })
    await w.run('presets', '--json')
    expect(w.json().presets[0].reader).toBe(defaultReader('claude', 'win32'))
  })
})
