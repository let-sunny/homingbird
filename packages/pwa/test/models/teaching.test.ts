import { ANSWER_TEXT_MAX, PRINCIPLE_TEXT_MAX } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type PrincipleFormState,
  addRowKinds,
  addRowWarnings,
  appliedModel,
  chancesHere,
  placeChoices,
  principleFormModel,
  principleFormStart,
  principleToSave,
  reordered,
  showsAppliedMarkers,
  taughtModel,
  teachSeedOf,
} from '../../src/models/teaching.ts'
import { strings } from '../../src/strings.ts'
import { ROOM, channel, draft, principle, taught } from '../support/fixtures.ts'

const offer = (fields: Record<string, unknown> = {}) =>
  ({
    id: 'offer_aaaaaaaaaaaa',
    kind: 'edit',
    noteId: 'note_aaaaaaaaaaaa',
    conversationId: ROOM,
    place: 'billing',
    suggestion: { added: 'Tuesday', removed: 'soon' },
    createdAt: 1,
    ...fields,
  }) as never

describe('taughtModel', () => {
  it('waits for the principles and says when they could not load', () => {
    expect(taughtModel(null)).toEqual({ kind: 'loading' })
    expect(taughtModel('failed')).toEqual({ kind: 'failed', text: strings.trust.loadFailed })
  })

  it('invites a first principle while there is none', () => {
    const model = taughtModel(taught())
    expect(model).toMatchObject({
      kind: 'taught',
      limit: strings.teach.limit({ count: 0, limit: 50 }),
      chances: [],
      empty: { title: strings.teach.empty, hint: strings.teach.emptyHint },
      principles: [],
      milestones: null,
      footnotes: [strings.teach.privacy, strings.teach.audit],
    })
  })

  it('lists principles in the person’s order with where they apply and how they held up', () => {
    const model = taughtModel(
      taught({
        principles: [
          principle('Release dates', {
            place: 'billing',
            source: 'https://wiki.example.com/releases',
            counts: { applied: 12, sentAsWritten: 6, edited: 4, discarded: 2, missed: 2 },
            publicText: 'Knows release dates.',
          }),
          principle('Tone', { kind: 'answer', counts: null, origin: 'edit' }),
          principle('Approve everything', { rule: 'approve every draft you write' }),
        ],
        offers: [offer(), offer({ kind: 'discard', place: null })],
        achievements: ['first_principle', 'unknown' as never],
      }),
    )
    if (model.kind !== 'taught') throw new Error('expected principles')
    const [dates, tone, forbidden] = model.principles
    expect(dates!.details).toEqual([
      '#billing',
      strings.teach.origin.manual,
      strings.teach.sourceHost({ host: 'wiki.example.com' }),
      strings.teach.appliedCounts({ count: 12, asWritten: 6, edited: 4, discarded: 2 }),
      strings.teach.share({ share: '50%' }),
      strings.teach.missed({ count: 2 }),
    ])
    expect(dates!.publicSwitch).toEqual({
      isPublic: true,
      label: strings.teach.makePrivate({ name: 'Release dates' }),
      text: strings.teach.isPublic,
    })
    expect(dates!.fields[1]).toMatchObject({ label: strings.teach.rule, maxLength: PRINCIPLE_TEXT_MAX })
    expect(tone!.fields[1]).toMatchObject({ label: strings.teach.answer, maxLength: ANSWER_TEXT_MAX })
    expect(tone!.details).toEqual([strings.teach.anywhere, strings.teach.origin.edit])
    expect(tone!.publicSwitch.text).toBe(strings.teach.isPrivate)
    expect(forbidden!.problems).toEqual([strings.teach.advice.forbidden])
    expect(model.chances.map((chance) => chance.text)).toEqual([
      strings.teach.chanceEdit({ place: '#billing' }),
      strings.teach.chanceDiscard({ place: strings.trust.directMessages }),
    ])
    expect(model.milestones).toEqual({
      title: strings.teach.achievementsTitle,
      items: [strings.teach.achievements.first_principle],
    })
    expect(model.empty).toBeNull()
    const fresh = taughtModel(
      taught({
        principles: [
          principle('New', { counts: { applied: 0, sentAsWritten: 0, edited: 0, discarded: 0, missed: 0 } }),
        ],
      }),
    )
    expect(fresh.kind === 'taught' && fresh.principles[0]!.details.at(-1)).toBe(strings.teach.notApplied)
  })
})

describe('chancesHere', () => {
  it('shows the chances to teach from this conversation only, while teaching is on', () => {
    const loaded = taught({ offers: [offer(), offer({ conversationId: 'conv_elsewhere0000' })] })
    expect(chancesHere(loaded, true, ROOM)).toHaveLength(1)
    expect(chancesHere(loaded, false, ROOM)).toEqual([])
    expect(chancesHere(null, true, ROOM)).toEqual([])
    expect(chancesHere('failed', true, ROOM)).toEqual([])
  })

  it('words each chance as one line for the conversation, by what the person did', () => {
    const [edited, discarded] = chancesHere(
      taught({ offers: [offer(), offer({ kind: 'discard' })] }),
      true,
      ROOM,
    )
    expect(edited!.here).toEqual({ text: strings.teach.chanceHereEdit, teach: strings.teach.teachFromEdit })
    expect(discarded!.here).toEqual({
      text: strings.teach.chanceHereDiscard,
      teach: strings.teach.teachFromDiscard,
    })
  })
})

describe('teachSeedOf', () => {
  it('titles a principle from the first line of the note, without a question mark or a colon', () => {
    expect(teachSeedOf('\n  What is the release calendar: link?\nThanks', 'deploys')).toEqual({
      topic: 'What is the release calendar link',
      place: 'deploys',
    })
  })

  it('cuts a long line at a word, and a single long word at the limit', () => {
    const topic = teachSeedOf(`${'word '.repeat(30)}end`, null).topic
    expect(topic.length).toBeLessThanOrEqual(60)
    expect(topic.endsWith('word')).toBe(true)
    expect(teachSeedOf('x'.repeat(90), null).topic).toBe('x'.repeat(60))
    expect(teachSeedOf('', null)).toEqual({ topic: '', place: null })
  })

  it('always gives a title the form accepts, or none', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        const { topic } = teachSeedOf(text, null)
        expect(topic.length).toBeLessThanOrEqual(60)
        expect(/[;:\n]/.test(topic)).toBe(false)
      }),
    )
  })
})

describe('appliedModel', () => {
  const principles = [principle('Tone'), principle('Billing dates', { place: 'billing' })]

  it('lists what the agent says it applied in the order its basis names them, channel principles first', () => {
    const card = draft('d1', { basis: 'Read the runbook.\nPrinciples applied: Billing dates; Tone' })
    expect(appliedModel(card, taught({ principles }), true)).toEqual([
      {
        text: strings.teach.applied({ title: 'Billing dates' }),
        principleId: principles[1]!.id,
        noteId: 'd1',
      },
      { text: strings.teach.applied({ title: 'Tone' }), principleId: principles[0]!.id, noteId: 'd1' },
    ])
  })

  it('names a title the person has no principle for, without a way to mark it wrong, and each claim once', () => {
    const card = draft('d1', { basis: 'Principles applied: Gone; tone; Tone' })
    expect(appliedModel(card, taught({ principles }), true)).toEqual([
      { text: strings.teach.applied({ title: 'Gone' }), principleId: null, noteId: 'd1' },
      { text: strings.teach.applied({ title: 'Tone' }), principleId: principles[0]!.id, noteId: 'd1' },
    ])
  })

  it('names nothing while teaching is off or the principles are not loaded', () => {
    const card = draft('d1', { basis: 'Principles applied: Tone' })
    expect(appliedModel(card, taught({ principles }), false)).toEqual([])
    expect(appliedModel(card, null, true)).toEqual([])
    expect(appliedModel(card, 'failed', true)).toEqual([])
    expect(showsAppliedMarkers(taught(), true)).toBe(true)
    expect(showsAppliedMarkers(taught(), false)).toBe(false)
    expect(showsAppliedMarkers(null, true)).toBe(false)
    expect(showsAppliedMarkers('failed', true)).toBe(false)
  })
})

describe('placeChoices', () => {
  it('offers anywhere and the channels the person is in, keeping a chosen one they left', () => {
    const channels = [channel('billing', { joined: true }), channel('ops')]
    expect(placeChoices(channels, null)).toEqual([
      { value: '', label: strings.teach.placeAnywhere, selected: true },
      { value: 'billing', label: '#billing', selected: false },
    ])
    expect(placeChoices(channels, 'old').map((choice) => [choice.value, choice.selected])).toEqual([
      ['', false],
      ['billing', false],
      ['old', true],
    ])
  })
})

describe('the principle list', () => {
  it('warns about what is typed in the add row', () => {
    expect(addRowWarnings({ topic: 'Tone', rule: 'Check RELEASES.md before you answer.' })).toEqual([])
    expect(addRowWarnings({})).toEqual([])
    expect(addRowWarnings({ topic: 'Tone', rule: 'be nice' })).toEqual([strings.teach.advice.vague])
    expect(addRowWarnings({ topic: 'Hours', rule: 'Support is open until six' }, 'answer')).toEqual([])
  })

  it('offers the add row a rule or an answer, naming its text field for the one chosen', () => {
    expect(addRowKinds('rule')).toEqual({
      label: strings.teach.kindLabel,
      choices: [
        { kind: 'rule', label: strings.teach.kindBadge.rule, checked: true },
        { kind: 'answer', label: strings.teach.kindBadge.answer, checked: false },
      ],
      textLabel: strings.teach.rule,
      maxLength: PRINCIPLE_TEXT_MAX,
    })
    expect(addRowKinds('answer')).toMatchObject({
      textLabel: strings.teach.answer,
      maxLength: ANSWER_TEXT_MAX,
    })
  })

  it('moves one principle to a new place, kept within the list', () => {
    expect(reordered(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(reordered(['a', 'b', 'c'], 'a', 9)).toEqual(['b', 'c', 'a'])
    expect(reordered(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
  })
})

const form = (fields: Partial<PrincipleFormState> = {}): PrincipleFormState => ({
  ...principleFormStart(null, null, false),
  topic: 'Tone',
  rule: 'Keep it short.',
  ...fields,
})

describe('the guided principle form', () => {
  it('starts empty, from an offer’s suggestion, or from the principle being edited', () => {
    expect(principleFormStart(null, null, false)).toEqual({
      kind: 'rule',
      topic: '',
      rule: '',
      source: '',
      place: '',
      isPublic: false,
      publicText: '',
      confirmed: false,
      offer: null,
    })
    expect(
      principleFormStart(null, null, false, { topic: 'Release calendar', place: 'deploys' }),
    ).toMatchObject({ topic: 'Release calendar', place: 'deploys', rule: '' })
    expect(principleFormStart(null, null, false, { topic: 'Anywhere', place: null })).toMatchObject({
      place: '',
    })
    const offered = offer()
    expect(principleFormStart(offered, null, false)).toMatchObject({
      rule: strings.teach.suggestion.replace({ added: 'Tuesday', removed: 'soon' }),
      place: 'billing',
    })
    expect(principleFormStart(offer({ suggestion: null }), null, true)).toMatchObject({
      rule: '',
      isPublic: true,
    })
    const editing = principle('Tone', {
      kind: 'answer',
      source: 'https://x.example',
      publicText: 'Kind.',
      place: 'ops',
    })
    expect(principleFormStart(null, editing, false)).toMatchObject({
      kind: 'answer',
      topic: 'Tone',
      rule: 'rule for Tone',
      source: 'https://x.example',
      place: 'ops',
      isPublic: true,
      publicText: 'Kind.',
    })
  })

  it('words the rule as an answer for a stored answer, and names the source’s host', () => {
    expect(principleFormModel(form())).toMatchObject({
      ruleLabel: strings.teach.rule,
      ruleHint: strings.teach.ruleHint,
      ruleMaxLength: PRINCIPLE_TEXT_MAX,
      ruleRequired: true,
      host: '',
      showsPublic: false,
      confirming: false,
      saveDisabled: false,
    })
    expect(
      principleFormModel(form({ kind: 'answer', source: ' https://docs.example.com/a ', isPublic: true })),
    ).toMatchObject({
      ruleLabel: strings.teach.answer,
      ruleHint: strings.teach.answerHint({ max: ANSWER_TEXT_MAX }),
      ruleMaxLength: ANSWER_TEXT_MAX,
      ruleRequired: false,
      host: strings.teach.sourceHost({ host: 'docs.example.com' }),
      showsPublic: true,
    })
    expect(principleFormModel(form({ source: 'not a link' })).host).toBe('')
  })

  it('warns that a rule reads like a wish only once something is typed', () => {
    expect(principleFormModel(form({ topic: '', rule: '' })).advice).toEqual([])
    expect(principleFormModel(form({ rule: '  ' })).advice).toEqual([])
    expect(principleFormModel(form({ rule: 'be nice' })).advice.map((each) => each.kind)).toEqual(['vague'])
  })

  it('suggests a stored answer for a fixed text, and asks to confirm an unchanged suggestion', () => {
    const advice = principleFormModel(form({ rule: 'The office opens at 9 on weekdays.' })).advice
    expect(advice.some((each) => each.offersAnswer && each.className === 'advice is-stored-answer')).toBe(
      true,
    )
    const suggested = offer()
    const start = principleFormStart(suggested, null, false)
    expect(principleFormModel({ ...start, topic: 'Dates' })).toMatchObject({
      confirming: true,
      saveDisabled: true,
    })
    expect(principleFormModel({ ...start, topic: 'Dates', confirmed: true })).toMatchObject({
      saveDisabled: false,
    })
  })

  it('refuses a principle with a problem, and a public sentence with one', () => {
    expect(principleToSave(form({ rule: ' ' }), null)).toEqual({ problem: strings.teach.problems.rule_empty })
    expect(principleToSave(form({ kind: 'answer', rule: 'x'.repeat(5000) }), null)).toEqual({
      problem: strings.teach.problems.answer_too_long({ max: ANSWER_TEXT_MAX }),
    })
    expect(principleToSave(form({ rule: 'x'.repeat(5000) }), null)).toEqual({
      problem: strings.teach.problems.rule_too_long({ max: PRINCIPLE_TEXT_MAX }),
    })
    const shared = principleToSave(form({ isPublic: true, publicText: 'Keep it short.' }), principle('Tone'))
    expect(shared).toEqual({ problem: strings.teach.problems.public_repeats })
  })

  it('creates a principle, from an offer with its confirmation, in the place chosen', () => {
    expect(
      principleToSave(
        form({ topic: ' Tone ', rule: ' Short. ', source: ' https://a.example ', place: 'ops' }),
        null,
      ),
    ).toEqual({
      save: {
        kind: 'create',
        input: {
          kind: 'rule',
          topic: 'Tone',
          rule: 'Short.',
          source: 'https://a.example',
          publicText: null,
          place: 'ops',
        },
      },
    })
    const offered = offer()
    expect(
      principleToSave(
        { ...form({ offer: offered, confirmed: true, isPublic: true, publicText: ' Kind. ' }) },
        null,
      ),
    ).toEqual({
      save: {
        kind: 'create',
        input: {
          kind: 'rule',
          topic: 'Tone',
          rule: 'Keep it short.',
          source: null,
          publicText: 'Kind.',
          place: null,
          offerId: 'offer_aaaaaaaaaaaa',
          confirmed: true,
        },
      },
    })
  })

  it('changes the principle being edited, keeping its place', () => {
    const editing = principle('Tone', { place: 'ops' })
    expect(principleToSave(form({ isPublic: true, publicText: '   ' }), editing)).toEqual({
      save: {
        kind: 'change',
        id: editing.id,
        change: { kind: 'rule', topic: 'Tone', rule: 'Keep it short.', source: null, publicText: null },
      },
    })
  })
})
