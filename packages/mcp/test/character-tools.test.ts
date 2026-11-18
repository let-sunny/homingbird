import { Task as T } from '@homingbird/kernel'
import { decodeCharacter } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { CHARACTER_SAVED_ONLY_BY_A_PERSON, CHARACTER_TOOLS } from '../src/character-tools.ts'
import { memberApiOf } from '../src/member-api.ts'
import { callTool, toolDefinitions } from '../src/tools.ts'
import { fakeApi, sequentialNonce } from './support.ts'

const OTTER = {
  version: 1,
  base: 'bubble-16',
  id: 'my-otter',
  name: 'Otter',
  palette: { B: '#8A6A52', D: '#6E523F', O: '#E7D3BF', F: '#6E523F' },
  noFeet: true,
  marks: [
    [5, 1, 1, 1, 'B'],
    [10, 1, 1, 1, 'B'],
    [15, 6, 1, 1, '#2E2018'],
    [4, 8, 2, 2, '#6E523F'],
  ],
}

const run = async (name: string, input: unknown, webClientUrl: string | null = 'https://hb.example.com') => {
  const fake = fakeApi({})
  const exit = await T.run(
    callTool(name, input, { api: memberApiOf(fake.api), nonce: sequentialNonce(), webClientUrl }),
  )
  if (exit._tag === 'Err') throw exit.error
  return { text: exit.value.content[0]!.text, isError: exit.value.isError, calls: fake.calls }
}

describe('check_character', () => {
  it('says a character passes, describes what it checked, and that only the person can save it', async () => {
    const { text, isError } = await run('check_character', { character: OTTER })
    expect(isError).toBeUndefined()
    expect(text).toMatch(
      /^passes: "Otter" \(my-otter\): body #8A6A52, wing #6E523F, beak #E7D3BF, feet #6E523F;/,
    )
    expect(text).toContain('4 marking(s) over 7 cell(s); no feet.')
    expect(text).toContain('the eye contrast')
    expect(text).toContain(CHARACTER_SAVED_ONLY_BY_A_PERSON)
  })

  it('lists every problem in the words of the character rules', async () => {
    const { text } = await run('check_character', {
      character: { ...OTTER, name: 'Pip', marks: [[12, 9, 1, 1, 'B']] },
    })
    expect(text.split('\n')).toEqual([
      '2 problem(s). Fix each one and check again; do not show your human a character that fails:',
      '- name: may not contain Claude, Anthropic, Homingbird or Pip',
      '- marks may not go below the beak (x 11-15, y 8-11): characters have no mouths',
    ])
  })

  it('refuses a made character that takes a built-in character’s id, as the server would', async () => {
    expect((await run('check_character', { character: { ...OTTER, id: 'fox' } })).text).toContain(
      '"fox" belongs to a built-in character',
    )
  })

  it('reads a character given as JSON text, and reports text that is not a character', async () => {
    expect((await run('check_character', { character: JSON.stringify(OTTER) })).text).toMatch(/^passes: /)
    expect((await run('check_character', { character: 'an otter, please' })).text).toMatch(/^\d+ problem/)
    expect((await run('check_character', { character: { palette: {}, marks: [] } })).text).toMatch(
      /^\d+ problem/,
    )
  })

  it('describes a character that keeps Pip’s colors', async () => {
    const text = (await run('check_character', { character: { ...OTTER, palette: { B: '#8A6A52' } } })).text
    expect(text).toContain('body #8A6A52;')
  })
})

describe('preview_character', () => {
  it('returns the editor link with the checked draft in it, and saves nothing', async () => {
    const { text, calls } = await run('preview_character', { character: OTTER })
    const link = /Show this link to your human: (\S+)/.exec(text)![1]!
    expect(link.startsWith('https://hb.example.com/#/character/')).toBe(true)
    expect(decodeCharacter(link.split('/').pop()!)).toEqual(OTTER)
    expect(text).toContain('Checked "Otter" (my-otter)')
    expect(text).toContain('a layer they can keep or remove')
    expect(text).toContain(CHARACTER_SAVED_ONLY_BY_A_PERSON)
    expect(calls).toEqual([])
  })

  it('gives no link for a character that fails, only the problems', async () => {
    const { text } = await run('preview_character', { character: { ...OTTER, marks: [[13, 1, 1, 1, 'B']] } })
    expect(text).not.toContain('#/character/')
    expect(text).toMatch(/^1 problem\(s\)/)
  })

  it('says where to find the editor when the web client’s address is not known', async () => {
    const { text } = await run('preview_character', { character: OTTER }, null)
    expect(text).not.toContain('http')
    expect(text).toContain('Profile, My character')
  })
})

describe('the character tools', () => {
  it('call no route at all, so no model can save or change a character', async () => {
    for (const tool of CHARACTER_TOOLS)
      for (const character of [OTTER, { ...OTTER, id: 'cat' }, 'save it'])
        expect((await run(tool.name, { character })).calls).toEqual([])
  })

  it('are read-only, and show the model the whole CharacterSpec format', () => {
    for (const tool of CHARACTER_TOOLS) expect(tool.readOnly).toBe(true)
    const definitions = toolDefinitions().filter((definition) =>
      String(definition.name).endsWith('_character'),
    )
    expect(definitions.map((definition) => definition.name)).toEqual(['check_character', 'preview_character'])
    for (const definition of definitions) {
      const schema = definition.inputSchema as {
        properties: { character: { properties: Record<string, unknown>; description: string } }
        required: string[]
      }
      expect(Object.keys(schema.properties.character.properties)).toEqual([
        'version',
        'base',
        'id',
        'name',
        'palette',
        'noFeet',
        'marks',
      ])
      expect(schema.properties.character.description).toContain('[x, y, w, h, color]')
      expect(schema.required).toEqual(['character'])
    }
  })

  it('need a character to look at', async () => {
    const { text, isError } = await run('check_character', {})
    expect(isError).toBe(true)
    expect(text).toContain('character: is required')
  })
})
