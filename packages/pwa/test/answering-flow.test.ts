import { ANSWERING_FLOW_MAX_CHARACTERS, answeringFlowFrom } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { flowLength, flowToSave, mayInsertExample } from '../src/answering-flow.ts'
import { en } from '../src/languages/en.ts'
import { ko } from '../src/languages/ko.ts'

describe('flowToSave', () => {
  it('saves an empty box as no flow at all', () => {
    expect(flowToSave('   ')).toBeNull()
  })

  it('saves a box of blank lines as no flow at all', () => {
    expect(flowToSave('\n\n')).toBeNull()
  })

  it('saves what was typed, trimmed', () => {
    expect(flowToSave(' 1. Ask. ')).toBe('1. Ask.')
  })
})

describe('flowLength', () => {
  it('counts against the limit the server enforces', () => {
    expect(flowLength('abc')).toEqual({ used: 3, max: ANSWERING_FLOW_MAX_CHARACTERS, over: false })
  })

  it('says when the text is over the limit', () => {
    expect(flowLength('x'.repeat(ANSWERING_FLOW_MAX_CHARACTERS + 1)).over).toBe(true)
  })
})

describe('mayInsertExample', () => {
  it('inserts the example into an empty box', () => {
    expect(mayInsertExample(' \n')).toBe(true)
  })

  it('never overwrites steps someone wrote', () => {
    expect(mayInsertExample('1. Ask the wiki.')).toBe(false)
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
  })
})
