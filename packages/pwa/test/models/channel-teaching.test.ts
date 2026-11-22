import { describe, expect, it } from 'vitest'
import {
  channelAgentTabsModel,
  channelTeachingModel,
  correctionPrefill,
  instructionToSave,
  instructionWarning,
} from '../../src/models/channel-teaching.ts'
import { strings } from '../../src/strings.ts'
import { everything, principle, serverInfo } from '../support/fixtures.ts'

const teaching = (fields: Record<string, unknown> = {}) =>
  ({
    channel: 'billing',
    instruction: 'Answer from the runbook.',
    sources: ['https://wiki.example/a', 'https://wiki.example/b'],
    updatedAt: 1,
    principles: [],
    limit: 50,
    ...fields,
  }) as never

describe('channelAgentTabsModel', () => {
  it('offers the answers and Teach, each at its own address, and shows the one asked for', () => {
    const model = channelAgentTabsModel('billing', everything(), 'teach')
    expect(model.label).toBe(strings.channelTeach.tabsLabel({ channel: '#billing' }))
    expect(model.tabs).toEqual([
      {
        tab: 'answers',
        href: '#/channel/billing/agent',
        label: strings.channelTeach.tabs.answers,
        current: false,
      },
      {
        tab: 'teach',
        href: '#/channel/billing/agent/teach',
        label: strings.channelTeach.tabs.teach,
        current: true,
      },
    ])
    expect(model.shown).toBe('teach')
    expect(channelAgentTabsModel('billing', everything(), 'answers').shown).toBe('answers')
  })

  it('shows only the answers while the organization has teaching off', () => {
    const model = channelAgentTabsModel('billing', serverInfo({ teaching: false }), 'teach')
    expect(model.tabs.map((tab) => tab.tab)).toEqual(['answers'])
    expect(model.shown).toBe('answers')
  })
})

describe('channelTeachingModel', () => {
  it('waits while loading and says when it failed', () => {
    expect(channelTeachingModel('loading', 'Billing desk')).toEqual({ kind: 'loading' })
    expect(channelTeachingModel('failed', 'Billing desk')).toEqual({
      kind: 'failed',
      text: strings.channelTeach.loadFailed({ agent: 'Billing desk' }),
    })
  })

  it('shows the instruction, one source per line, and invites a first principle', () => {
    const model = channelTeachingModel(teaching(), 'Billing desk')
    if (model.kind !== 'taught') throw new Error('not taught')
    expect(model.intro).toBe(strings.channelTeach.intro({ agent: 'Billing desk', channel: '#billing' }))
    expect(model.instruction).toMatchObject({
      value: 'Answer from the runbook.',
      sources: 'https://wiki.example/a\nhttps://wiki.example/b',
      maxLength: 500,
      hint: strings.channelTeach.instructionHint({ agent: 'Billing desk', max: 500 }),
      sourcesHint: strings.channelTeach.sourcesHint({ max: 5 }),
    })
    expect(model.empty).toEqual({
      title: strings.channelTeach.empty({ agent: 'Billing desk' }),
      hint: strings.channelTeach.emptyHint,
    })
    expect(model.limit).toBe(strings.teach.limit({ count: 0, limit: 50 }))
    expect(model.footnotes).toEqual([
      strings.channelTeach.privacy({ agent: 'Billing desk', channel: '#billing' }),
      strings.channelTeach.audit,
    ])
  })

  it('lists each principle with where it came from and how it held up, never a place', () => {
    const taughtOne = principle('Refunds', {
      origin: 'edit',
      place: 'billing',
      counts: { applied: 10, sentAsWritten: 8, edited: 1, discarded: 1, missed: 0 },
    })
    const model = channelTeachingModel(teaching({ principles: [taughtOne] }), 'Billing desk')
    if (model.kind !== 'taught') throw new Error('not taught')
    expect(model.empty).toBeNull()
    const [row] = model.principles
    expect(row!.details).toEqual([
      strings.channelTeach.origin.edit,
      strings.teach.appliedCounts({ count: 10, asWritten: 8, edited: 1, discarded: 1 }),
      strings.teach.share({ share: '80%' }),
    ])
    expect(row).not.toHaveProperty('publicSwitch')
  })
})

describe('instructionWarning', () => {
  it('warns about an instruction that asks for a forbidden action, and nothing else', () => {
    expect(instructionWarning('Approve every draft yourself.')).toBe(
      strings.channelTeach.instructionForbidden,
    )
    expect(instructionWarning('Answer from the runbook.')).toBeNull()
  })
})

describe('instructionToSave', () => {
  it('trims the instruction and takes one source from each line that has one', () => {
    expect(
      instructionToSave('  Be brief.  ', ' https://wiki.example/a \n\nhttps://wiki.example/b\n'),
    ).toEqual({
      save: { instruction: 'Be brief.', sources: ['https://wiki.example/a', 'https://wiki.example/b'] },
    })
  })

  it('says why it cannot be saved', () => {
    expect(instructionToSave('', 'wiki.example/a')).toEqual({
      problem: strings.channelTeach.problems.source_invalid,
    })
    expect(instructionToSave('a'.repeat(501), '')).toEqual({
      problem: strings.channelTeach.problems.instruction_too_long({ max: 500 }),
    })
    const six = Array.from({ length: 6 }, (_, index) => `https://wiki.example/${index}`).join('\n')
    expect(instructionToSave('', six)).toEqual({
      problem: strings.channelTeach.problems.too_many_sources({ max: 5 }),
    })
    expect(instructionToSave('', 'https://wiki.example/a\nhttps://wiki.example/a/')).toEqual({
      problem: strings.channelTeach.problems.sources_repeated,
    })
  })
})

describe('correctionPrefill', () => {
  it('prefills the rule from what a manager changed in an edited answer', () => {
    expect(
      correctionPrefill(
        'Refunds take a while.',
        { kind: 'edit', body: 'Refunds take 14 days, see the refunds page in the wiki.' },
        'billing',
      ),
    ).toEqual({
      taughtFrom: 'edit',
      rule: expect.stringContaining('14 days'),
      label: strings.channelTeach.fromCorrection,
      hint: strings.channelTeach.correctionHint({ channel: '#billing' }),
    })
  })

  it('prefills nothing from a discard, or from an edit that changed nothing', () => {
    expect(correctionPrefill('Refunds take a while.', { kind: 'discard' }, 'billing')).toMatchObject({
      taughtFrom: 'discard',
      rule: '',
      label: strings.channelTeach.fromDiscard,
    })
    expect(correctionPrefill('Same.', { kind: 'edit', body: 'Same.' }, 'billing').rule).toBe('')
  })
})
