import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { RPC_CODE } from '../src/json-rpc.ts'
import { PROMPTS, getPrompt, promptDefinitions } from '../src/prompts.ts'
import { TOOLS } from '../src/tools.ts'

const get = async (name: unknown, given?: unknown) => {
  const exit = await T.run(T.result(getPrompt(PROMPTS, name, given)))
  if (exit._tag === 'Err') throw new Error('getPrompt died')
  return exit.value as any
}

describe('promptDefinitions', () => {
  it('lists inbox, ask, watch, character, teach and open with a title, a description and their arguments', () => {
    const listed = promptDefinitions() as any[]
    expect(listed.map((prompt) => prompt.name)).toEqual([
      'inbox',
      'ask',
      'watch',
      'character',
      'teach',
      'open',
    ])
    for (const prompt of listed) {
      expect(Object.keys(prompt).sort()).toEqual(['arguments', 'description', 'name', 'title'])
      expect(prompt.description.length).toBeGreaterThan(10)
    }
    expect(listed[1].arguments).toEqual([
      { name: 'who', description: expect.any(String), required: true },
      { name: 'what', description: expect.any(String), required: true },
    ])
  })

  it('lists the prompts it is given', () => {
    expect(promptDefinitions([PROMPTS[0]!])).toHaveLength(1)
  })
})

describe('getPrompt', () => {
  it('returns one user message of text, as the specification shapes it', async () => {
    const { value } = await get('inbox')
    expect(value.description).toBe(PROMPTS[0]!.description)
    expect(value.messages).toHaveLength(1)
    expect(value.messages[0]).toEqual({ role: 'user', content: { type: 'text', text: expect.any(String) } })
  })

  it('names only tools that exist, and none that could send', async () => {
    const names = new Set(TOOLS.map((tool) => tool.name))
    for (const prompt of PROMPTS) {
      const text = String(prompt.text({ who: 'June', what: 'x' }))
      for (const mentioned of text.match(/\b[a-z]+_[a-z_]+\b/g) ?? []) expect(names).toContain(mentioned)
      expect(text).not.toMatch(/\b(approve it|send it|discard)\b/)
    }
  })

  it('makes a character the way the make-character skill does: ask, start from a built-in, check, link', async () => {
    const text = (await get('character')).value.messages[0].content.text as string
    const order = [
      'ask me',
      'closest built-in character',
      'check_character',
      'preview_character',
      '"Use this character"',
    ]
    const positions = order.map((phrase) => text.indexOf(phrase))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(text).toContain('no tool can')
    expect(text).toContain('mouth zone (x 11-15, y 8-11)')
    expect(text.match(/^\{"version":1,"base":"bubble-16","id":"[a-z-]+"/gm)).toHaveLength(23)
  })

  it('starts the character conversation from the person’s idea when they give one', async () => {
    const text = (await get('character', { idea: ' a sleepy otter ' })).value.messages[0].content.text
    expect(text).toContain('I have this in mind: a sleepy otter.')
    expect(text).not.toContain('First ask me')
    expect((await get('character', { idea: '  ' })).value.messages[0].content.text).toContain('First ask me')
  })

  it('puts who and what into the ask prompt', async () => {
    const { value } = await get('ask', { who: 'June', what: 'Is the migration safe?' })
    expect(value.messages[0].content.text).toContain(
      'Draft a Homingbird note to June: Is the migration safe?',
    )
    expect(value.messages[0].content.text).toContain('draft_note')
  })

  it.each([
    [undefined, 'who, what'],
    [{}, 'who, what'],
    [{ who: 'June' }, 'what'],
    [{ who: 'June', what: '  ' }, 'what'],
    [{ who: 7, what: 'x' }, 'who'],
    [['June', 'x'], 'who, what'],
  ])('refuses ask with arguments %j as invalid params, naming what is missing', async (given, missing) => {
    const result = await get('ask', given)
    expect(result).toMatchObject({ _tag: 'Err', error: { code: RPC_CODE.invalidParams } })
    expect(result.error.message).toBe(`Missing required arguments: ${missing}`)
  })

  it('refuses an unknown prompt as invalid params', async () => {
    for (const name of ['approve', undefined, 7])
      expect(await get(name)).toMatchObject({ _tag: 'Err', error: { code: RPC_CODE.invalidParams } })
  })

  it('tells the agent to keep waiting in the watch prompt, and to show the link in the open prompt', async () => {
    expect((await get('watch')).value.messages[0].content.text).toMatch(/wait_for_notes[\s\S]*again/)
    expect((await get('open')).value.messages[0].content.text).toContain('open_homingbird')
  })
})
