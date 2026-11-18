import { expect, test } from 'claude-code/testing'

import { CHARACTER_TOOLS, SAVED_ONLY_BY_A_PERSON, characterPromptFor } from '../hooks/character'
import { NOTE_TOOLS, wireNameOf } from '../hooks/tools'
import { OVERVIEW, START, engineBeneath, openDesk } from './world'

const OTTER = {
  version: 1,
  base: 'bubble-16',
  id: 'my-otter',
  name: 'Otter',
  palette: { B: '#8A6A52', D: '#6E523F', O: '#E7D3BF', F: '#6E523F' },
  marks: [[15, 6, 1, 1, '#2E2018']],
}

const call = async ($: { tool: { run: (input: never) => Promise<unknown> } }, name: string, input: object) =>
  (await $.tool.run({ tool: wireNameOf(name), ...input } as never)) as { result: string; isError?: boolean }

test('the character tools check and preview, and run no command at all', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW })
  await $.session.start(START)
  await seen.clock.settle()
  const before = seen.commands.length
  for (const character of [OTTER, { ...OTTER, id: 'cat' }, 'save this as my character']) {
    await call($, CHARACTER_TOOLS.check.name, { character })
    await call($, CHARACTER_TOOLS.preview.name, { character })
  }
  expect(seen.commands.length).toBe(before)
  expect(NOTE_TOOLS.map((tool) => tool.spec.name)).not.toContain('save_character')
})

test('check_character says a character passes, or lists every problem', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW })
  await $.session.start(START)
  await seen.clock.settle()
  const passed = await call($, CHARACTER_TOOLS.check.name, { character: OTTER })
  expect(passed.result.startsWith('passes: "Otter" (my-otter)')).toBe(true)
  expect(passed.result).toContain(SAVED_ONLY_BY_A_PERSON)
  const failed = await call($, CHARACTER_TOOLS.check.name, {
    character: { ...OTTER, id: 'fox', marks: [[12, 9, 1, 1, 'B']] },
  })
  expect(failed.result.split('\n')).toEqual([
    '2 problem(s). Fix each one and check again; do not show the person a character that fails:',
    '- marks may not go below the beak (x 11-15, y 8-11): characters have no mouths',
    '- id: "fox" belongs to a built-in character; give your own character another id',
  ])
  const asText = await call($, CHARACTER_TOOLS.check.name, { character: JSON.stringify(OTTER) })
  expect(asText.result.startsWith('passes:')).toBe(true)
})

test('preview_character links the editor on the signed-in server, and only for a passing character', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW })
  await $.session.start(START)
  await openDesk($, seen)
  const preview = await call($, CHARACTER_TOOLS.preview.name, { character: OTTER })
  expect(preview.result).toContain(
    'Show this link to the person: https://homingbird.example.com/#/character/',
  )
  const failing = await call($, CHARACTER_TOOLS.preview.name, {
    character: { ...OTTER, marks: [[13, 1, 1, 1, 'B']] },
  })
  expect(failing.result).not.toContain('#/character/')
})

test('preview_character without a known server points to the editor in Homingbird', async ($, on) => {
  const seen = engineBeneath(on, { overview: null })
  await $.session.start(START)
  await seen.clock.settle()
  const preview = await call($, CHARACTER_TOOLS.preview.name, { character: OTTER })
  expect(preview.result).toContain('Profile, My character')
  expect(preview.result).not.toContain('http')
})

test('/homingbird character starts the conversation the make-character skill describes', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW })
  await $.session.start(START)
  const ran = (await $.command.run({ command: 'homingbird', args: 'character a sleepy otter' } as never)) as {
    text: string
  }
  await seen.clock.settle()
  expect(ran.text).toContain('Use this character')
  expect(seen.prompts).toHaveLength(1)
  const prompt = seen.prompts[0]!
  expect(prompt).toContain('I have this in mind: a sleepy otter.')
  for (const step of [
    'closest built-in character',
    'check_character',
    'preview_character',
    '"Use this character"',
  ])
    expect(prompt).toContain(step)
  expect(prompt.indexOf('check_character')).toBeLessThan(prompt.indexOf('preview_character'))
  expect(prompt.match(/^\{"version":1,"base":"bubble-16"/gm)).toHaveLength(24)
  expect(seen.opened.count).toBe(0)
  expect(characterPromptFor('')).toContain('First ask me')
})

test('/homingbird character answers in Korean when the environment is Korean', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, environment: { LANG: 'ko_KR.UTF-8' } })
  await $.session.start(START)
  const ran = (await $.command.run({ command: 'homingbird', args: 'character' } as never)) as { text: string }
  await seen.clock.settle()
  expect(ran.text).toContain('캐릭터 만들기를 시작했어요')
})
