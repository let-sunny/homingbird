import { err, ok } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import {
  ANSWERING_FLOW_UNAVAILABLE,
  answeringFlowInstructions,
} from '../../src/drafting/answering-flow-instructions.ts'
import { draftingGuidance, flowGuidance, principlesGuidance } from '../../src/drafting/drafting-guidance.ts'
import { PRINCIPLES_UNAVAILABLE, principlesInstructions } from '../../src/drafting/principle-selection.ts'

describe('draftingGuidance', () => {
  it('puts the answering flow before the principles and leaves out an empty part', () => {
    expect(draftingGuidance('Flow', 'Principles')).toBe('Flow\n\nPrinciples')
    expect(draftingGuidance('', 'Principles')).toBe('Principles')
    expect(draftingGuidance('Flow', '')).toBe('Flow')
    expect(draftingGuidance('', '')).toBe('')
  })
})

describe('flowGuidance', () => {
  it('gives the flow’s instructions, and nothing when the administrator set none', () => {
    expect(flowGuidance(ok({ flow: '## Before drafting\n1. Look it up.' }))).toBe(
      answeringFlowInstructions({ before: ['Look it up.'], checks: [] }),
    )
    expect(flowGuidance(ok({ flow: null }))).toBe('')
  })

  it('says the flow is missing when it failed or cannot be read, and nothing when the feature is off', () => {
    expect(flowGuidance(err({ _tag: 'Unavailable' }))).toBe(ANSWERING_FLOW_UNAVAILABLE)
    expect(flowGuidance(err({ _tag: 'TimeoutError' }))).toBe(ANSWERING_FLOW_UNAVAILABLE)
    expect(flowGuidance(ok({ flow: 'not a list' }))).toBe(ANSWERING_FLOW_UNAVAILABLE)
    expect(flowGuidance(err({ _tag: 'NotFound' }))).toBe('')
  })
})

describe('principlesGuidance', () => {
  const selection = {
    principles: [{ kind: 'rule' as const, topic: 'Release dates', rule: 'check RELEASES.md', source: null }],
    leftOut: 0,
    ignored: [],
    ignoredLeftOut: 0,
  }

  it('gives the selected principles, says when they could not be fetched, and nothing when teaching is off', () => {
    expect(principlesGuidance(ok(selection))).toBe(principlesInstructions(selection))
    expect(principlesGuidance(err({ _tag: 'Invalid' }))).toBe(PRINCIPLES_UNAVAILABLE)
    expect(principlesGuidance(err({ _tag: 'NotFound' }))).toBe('')
  })
})
