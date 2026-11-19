import { ANSWERING_FLOW_MAX_CHARACTERS, type FlowStep, answeringFlowFrom } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { flowSize, flowToSave, mayInsertExample, moveStep, stepsFrom } from '../src/answering-flow.ts'
import { en } from '../src/languages/en.ts'
import { ko } from '../src/languages/ko.ts'

const step = (text: string, part: FlowStep['part'] = 'before', enabled = true): FlowStep => ({
  part,
  text,
  enabled,
})

describe('stepsFrom and flowToSave', () => {
  it('saves no steps as no flow at all, and reads no flow as no steps', () => {
    expect(flowToSave([])).toBeNull()
    expect(flowToSave([step('   ')])).toBeNull()
    expect(stepsFrom(null)).toEqual([])
    expect(stepsFrom('  ')).toEqual([])
    expect(stepsFrom('## Elsewhere\n1. x')).toEqual([])
  })

  it('round-trips the steps an administrator keeps, turned off ones included', () => {
    const steps = [
      step('Ask the wiki.'),
      step('Read the runbook.', 'before', false),
      step('No secrets.', 'checks'),
    ]
    expect(stepsFrom(flowToSave(steps))).toEqual(steps)
  })
})

describe('flowSize', () => {
  it('counts characters and steps against the limits the server enforces', () => {
    expect(flowSize([step('Ask.')])).toMatchObject({
      steps: 1,
      max: ANSWERING_FLOW_MAX_CHARACTERS,
      over: false,
    })
    expect(flowSize([step('x'.repeat(ANSWERING_FLOW_MAX_CHARACTERS))]).over).toBe(true)
    expect(flowSize(Array.from({ length: 21 }, (_, index) => step(`Step ${index}.`))).over).toBe(true)
  })
})

describe('mayInsertExample', () => {
  it('inserts the example only when there are no steps, never over steps someone wrote', () => {
    expect(mayInsertExample([])).toBe(true)
    expect(mayInsertExample([step('Ask the wiki.')])).toBe(false)
  })
})

describe('moveStep', () => {
  it('moves a step within its own list and keeps every step once', () => {
    const steps = [step('a'), step('b'), step('c'), step('x', 'checks')]
    expect(moveStep(steps, steps[2]!, 0).map((each) => each.text)).toEqual(['c', 'a', 'b', 'x'])
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), fc.integer({ min: -2, max: 6 }), (from, to) => {
        const moved = moveStep(steps, steps[from]!, to)
        expect([...moved].sort((a, b) => a.text.localeCompare(b.text))).toEqual(
          [...steps].sort((a, b) => a.text.localeCompare(b.text)),
        )
        expect(moved.at(-1)!.part).toBe('checks')
      }),
    )
  })
})

describe.each([
  ['en', en],
  ['ko', ko],
])('the %s example answering flow', (_, language) => {
  it('is a flow the server accepts, with steps before drafting and checks on the draft', () => {
    const parsed = answeringFlowFrom(language.answeringFlow.example)
    expect(parsed._tag).toBe('Ok')
    if (parsed._tag !== 'Ok') return
    expect(parsed.value.before).toHaveLength(1)
    expect(parsed.value.checks).toHaveLength(2)
    expect(stepsFrom(language.answeringFlow.example)).toHaveLength(3)
  })
})
