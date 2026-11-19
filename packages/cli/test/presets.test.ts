import { describe, expect, it } from 'vitest'
import { world } from './support.ts'

describe('homingbird presets', () => {
  it('lists each preset with its commands, its reader’s tools and how far it is verified', async () => {
    const w = world({ signedIn: 'none' })
    expect(await w.run('presets')).toBe(0)
    const text = w.lines[0]!
    expect(text).toContain('claude  Claude Code; verified with Claude Code 2.1.327')
    expect(text).toContain('codex  Codex CLI; from source, unrun')
    expect(text).toContain('antigravity  Antigravity CLI (agy); from source, unrun')
    expect(text).toContain('gemini  Gemini CLI, legacy')
    expect(text).toContain("reader:  claude -p --tools '' --strict-mcp-config  (no tools)")
    expect(text).toMatch(/reader: {2}codex exec .* {2}\(minimal tools, not none\)/)
    expect(text).toContain('reader:  none known; with --split, give --reader yourself')
    await w.run('presets', '--json')
    const listed = w.json().presets
    expect(listed.map((preset: { name: string }) => preset.name)).toEqual([
      'claude',
      'codex',
      'antigravity',
      'gemini',
    ])
    expect(listed[1]).toMatchObject({ readerTools: 'minimal', state: 'from source, unrun' })
    expect(w.calls).toEqual([])
  })

  it('shows the Windows form of the Claude Code reader on Windows', async () => {
    const w = world({ signedIn: 'none', platform: 'win32' })
    await w.run('presets', '--json')
    expect(w.json().presets[0].reader).toBe('claude -p --tools "" --strict-mcp-config')
  })
})
