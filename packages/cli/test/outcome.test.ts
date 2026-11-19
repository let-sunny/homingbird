import { describe, expect, it } from 'vitest'
import { outcome } from '../src/outcome.ts'
import { world } from './support.ts'

describe('outcome', () => {
  it('keeps what a command prints as JSON apart from what it prints as text', () => {
    const json = { drafts: [] }
    const step = outcome(json, 'No drafts are waiting.')
    expect(step.json).toBe(json)
    expect(step.text).toBe('No drafts are waiting.')
  })

  it('is printed as its text, or as its JSON with --json', async () => {
    const plain = world()
    await plain.run('--version')
    const asJson = world()
    await asJson.run('--version', '--json')
    expect(plain.lines[0]).toMatch(/^homingbird /)
    expect(JSON.parse(asJson.lines[0]!)).toEqual({ version: expect.any(String) })
  })
})
