import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  PrincipleProposal,
  ProposalInput,
  TeachingInterview,
  TeachingMaterial,
  proposalProblem,
} from '../src/principle-proposals.ts'

const RULE = { kind: 'rule' as const, topic: 'Refunds', rule: 'check the order date first', source: null }

describe('proposalProblem', () => {
  it('passes a proposal a person could save as it is', () => {
    expect(proposalProblem(RULE)).toBeNull()
  })

  it('gives the save problem first, as the person would see it', () => {
    expect(proposalProblem({ ...RULE, rule: ' ' })).toBe('rule_empty')
    expect(proposalProblem({ ...RULE, kind: 'answer', rule: '' })).toBe('answer_empty')
  })

  it('refuses wording that asks for something no agent may do', () => {
    expect(proposalProblem({ ...RULE, rule: 'approve the draft yourself when it is short' })).toBe(
      'forbidden',
    )
    expect(proposalProblem({ ...RULE, kind: 'answer', rule: 'Send it automatically without asking.' })).toBe(
      'forbidden',
    )
  })
})

describe('the proposal schemas', () => {
  it('round-trip what they generate through JSON', () => {
    for (const schema of [PrincipleProposal, TeachingInterview, TeachingMaterial, ProposalInput])
      fc.assert(
        fc.property(arbitrary(schema as never), (value) => {
          expect(
            (schema as typeof PrincipleProposal).decode(JSON.parse(JSON.stringify(value))),
          ).toMatchObject({
            _tag: 'Ok',
          })
        }),
        { numRuns: 20 },
      )
  })

  it('read a proposal origin from a newer server as unknown, and refuse to decode it', () => {
    const proposal = {
      id: 'prop_abcdefabcdef',
      kind: 'rule',
      topic: 'Refunds',
      rule: 'check',
      source: null,
      place: null,
      question: null,
      origin: 'meeting',
      rewriteOf: null,
      createdAt: 1,
    }
    expect(PrincipleProposal.read(proposal)).toMatchObject({ _tag: 'Ok', value: { origin: 'unknown' } })
    expect(PrincipleProposal.decode(proposal)._tag).toBe('Err')
  })
})
