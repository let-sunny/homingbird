import type { MemberId } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type PeoplePickerInput,
  type PickerCandidate,
  candidatesAmong,
  chosenAmong,
  messageCandidates,
  peoplePickerModel,
  pickerKey,
  roomCandidates,
  withChosen,
} from '../../src/models/people-picker.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, conversation, entry, member } from '../support/fixtures.ts'

const DEE = 'mem_dee000000000' as MemberId
const AWAY = { humanOnline: false, agentOnline: false }

const candidate = (memberId: MemberId, name: string, reason: string | null = null): PickerCandidate => ({
  memberId,
  name,
  email: `${name.toLowerCase()}@example.com`,
  presence: AWAY,
  reason,
})

const PEOPLE = [candidate(BEN, 'Ben'), candidate(CY, 'Cy'), candidate(DEE, 'Dee', 'You blocked Dee.')]

const input = (fields: Partial<PeoplePickerInput> = {}): PeoplePickerInput => ({
  id: 'to',
  candidates: PEOPLE,
  chosen: [],
  query: '',
  active: null,
  open: true,
  limit: null,
  ...fields,
})

describe('peoplePickerModel', () => {
  it('lists everyone not chosen yet while open, marking the first that may be chosen', () => {
    const model = peoplePickerModel(input())
    expect(model.expanded).toBe(true)
    expect(model.options.map((option) => [option.name, option.active, option.disabled])).toEqual([
      ['Ben', true, false],
      ['Cy', false, false],
      ['Dee', false, true],
    ])
    expect(model.options[2]!.reason).toBe('You blocked Dee.')
    expect(model.activeId).toBe(`to-${BEN}`)
    expect(model.status).toBe(strings.picker.matches({ count: 3 }))
    expect(model.full).toBeNull()
  })

  it('matches what was typed against names and email addresses, in any case', () => {
    expect(peoplePickerModel(input({ query: ' CY ' })).options.map((option) => option.name)).toEqual(['Cy'])
    expect(peoplePickerModel(input({ query: 'ben@' })).options.map((option) => option.name)).toEqual(['Ben'])
    const none = peoplePickerModel(input({ query: 'zed ' }))
    expect(none.expanded).toBe(false)
    expect(none.activeId).toBeNull()
    expect(none.status).toBe(strings.picker.noMatch({ query: 'zed' }))
  })

  it('shows the people chosen as chips, in the order chosen, and leaves them out of the list', () => {
    const model = peoplePickerModel(input({ chosen: [CY, BEN, CY, DEE, ANA] }))
    expect(model.chips).toEqual([
      { memberId: CY, name: 'Cy', removeLabel: strings.picker.remove({ name: 'Cy' }) },
      { memberId: BEN, name: 'Ben', removeLabel: strings.picker.remove({ name: 'Ben' }) },
    ])
    expect(model.options.map((option) => option.name)).toEqual(['Dee'])
    expect(model.activeId).toBeNull()
    const everyone = peoplePickerModel(input({ candidates: PEOPLE.slice(0, 2), chosen: [BEN, CY] }))
    expect(everyone.status).toBe(strings.picker.nobodyLeft)
  })

  it('keeps the option moved to with the arrow keys, and says nothing while closed', () => {
    const model = peoplePickerModel(input({ active: CY, open: false }))
    expect(model.expanded).toBe(false)
    expect(model.activeId).toBe(`to-${CY}`)
    expect(model.status).toBe('')
    expect(peoplePickerModel(input({ active: DEE })).activeId).toBe(`to-${BEN}`)
  })

  it('takes no one more once full, and says so', () => {
    const model = peoplePickerModel(input({ chosen: [BEN], limit: 1 }))
    expect(model.full).toBe(strings.picker.full({ count: 1 }))
    expect(model.options.every((option) => option.disabled)).toBe(true)
    expect(model.activeId).toBeNull()
  })
})

describe('pickerKey', () => {
  const model = peoplePickerModel(input({ chosen: [DEE] }))

  it('does nothing while an input method composes a word', () => {
    for (const key of ['Enter', 'ArrowDown', 'Backspace', 'Escape'])
      expect(pickerKey(key, true, '', model)).toEqual({ kind: 'none' })
  })

  it('moves through the people who may be chosen, around the ends', () => {
    const shown = peoplePickerModel(input())
    expect(pickerKey('ArrowDown', false, '', shown)).toEqual({ kind: 'move', memberId: CY })
    expect(pickerKey('ArrowUp', false, '', shown)).toEqual({ kind: 'move', memberId: CY })
    const onCy = peoplePickerModel(input({ active: CY }))
    expect(pickerKey('ArrowDown', false, '', onCy)).toEqual({ kind: 'move', memberId: BEN })
    const nobody = peoplePickerModel(input({ query: 'zed' }))
    expect(pickerKey('ArrowDown', false, 'zed', nobody)).toEqual({ kind: 'none' })
  })

  it('chooses the marked person on Enter, and nobody when none is marked', () => {
    expect(pickerKey('Enter', false, '', peoplePickerModel(input()))).toEqual({
      kind: 'choose',
      memberId: BEN,
    })
    expect(pickerKey('Enter', false, 'zed', peoplePickerModel(input({ query: 'zed' })))).toEqual({
      kind: 'none',
    })
  })

  it('takes the last chip out on Backspace in an empty field only', () => {
    const chosen = peoplePickerModel(input({ chosen: [BEN, CY] }))
    expect(pickerKey('Backspace', false, '', chosen)).toEqual({ kind: 'remove', memberId: CY })
    expect(pickerKey('Backspace', false, 'b', chosen)).toEqual({ kind: 'none' })
    expect(pickerKey('Backspace', false, '', peoplePickerModel(input()))).toEqual({ kind: 'none' })
  })

  it('closes an open list on Escape and leaves other keys alone', () => {
    expect(pickerKey('Escape', false, '', peoplePickerModel(input()))).toEqual({ kind: 'close' })
    expect(pickerKey('Escape', false, '', peoplePickerModel(input({ open: false })))).toEqual({
      kind: 'none',
    })
    expect(pickerKey('a', false, '', model)).toEqual({ kind: 'none' })
  })
})

describe('choosing', () => {
  it('never holds a person twice, nor more than the limit, nor someone who may not be chosen', () => {
    const ids = fc.constantFrom(ANA, BEN, CY, DEE)
    fc.assert(
      fc.property(
        fc.array(ids),
        fc.option(fc.integer({ min: 0, max: 3 }), { nil: null }),
        (chosen, limit) => {
          const kept = chosenAmong(PEOPLE, chosen, limit)
          expect(new Set(kept).size).toBe(kept.length)
          expect(kept).not.toContain(DEE)
          expect(kept).not.toContain(ANA)
          if (limit !== null) expect(kept.length).toBeLessThanOrEqual(limit)
        },
      ),
    )
  })

  it('adds a person once, and no one past the limit', () => {
    expect(withChosen([BEN], CY, null)).toEqual([BEN, CY])
    expect(withChosen([BEN], BEN, null)).toEqual([BEN])
    expect(withChosen([BEN], CY, 1)).toEqual([BEN])
  })
})

describe('messageCandidates', () => {
  it('lists the people one wrote with most recently first, then by name, leaving out oneself and agents', () => {
    const listed = messageCandidates({
      directory: [
        entry(ANA, 'Ana', { relation: 'self', canMessage: false }),
        entry(CY, 'Cy'),
        entry(DEE, 'Dee'),
        entry(BEN, 'Ben'),
        {
          ...entry('mem_agent0000000' as MemberId, 'Billing agent'),
          member: member('mem_agent0000000' as MemberId, 'Billing agent', { kind: 'channel_agent' }),
        },
      ],
      conversations: [
        conversation({ participantIds: [ANA, DEE], lastActivityAt: 5 }),
        conversation({ kind: 'group', participantIds: [ANA, CY, DEE], lastActivityAt: 9 }),
        conversation({ kind: 'channel', participantIds: [ANA, BEN], lastActivityAt: 99 }),
      ],
      viewerId: ANA,
      contactMode: 'open',
    })
    expect(listed.map((one) => one.name)).toEqual(['Cy', 'Dee', 'Ben'])
    expect(listed.every((one) => one.reason === null)).toBe(true)
  })

  it('says why a person cannot be written to instead of leaving them out', () => {
    const reasonFor = (
      fields: Partial<ReturnType<typeof entry>>,
      contactMode: 'open' | 'contacts' = 'contacts',
    ) =>
      messageCandidates({
        directory: [entry(BEN, 'Ben', { canMessage: false, ...fields })],
        conversations: [],
        viewerId: ANA,
        contactMode,
      })[0]!.reason
    expect(reasonFor({ relation: 'blocked' })).toBe(strings.picker.blocked({ name: 'Ben' }))
    expect(reasonFor({ member: member(BEN, 'Ben', { status: 'deactivated' }) })).toBe(
      strings.picker.inactive({ name: 'Ben' }),
    )
    expect(reasonFor({}, 'open')).toBe(strings.picker.cannot({ name: 'Ben' }))
    expect(reasonFor({ relation: 'contact' })).toBe(strings.picker.cannot({ name: 'Ben' }))
    expect(reasonFor({ relation: 'request_sent' })).toBe(strings.picker.requested({ name: 'Ben' }))
    expect(reasonFor({ relation: 'request_received' })).toBe(strings.picker.toAccept({ name: 'Ben' }))
    expect(reasonFor({ relation: 'none' })).toBe(strings.picker.contactsOnly({ name: 'Ben' }))
  })
})

describe('candidatesAmong', () => {
  it('offers every person but those excluded, by name', () => {
    const listed = candidatesAmong([entry(CY, 'Cy'), entry(ANA, 'Ana'), entry(BEN, 'Ben')], new Set([ANA]))
    expect(listed).toEqual([candidate(BEN, 'Ben'), candidate(CY, 'Cy')])
  })
})

describe('roomCandidates', () => {
  it('lists the person who asked the note and anyone the viewer blocked with the reason, never the viewer', () => {
    const directory = [
      entry(ANA, 'Ana'),
      entry(BEN, 'Ben'),
      entry(CY, 'Cy', { relation: 'blocked' }),
      entry(DEE, 'Dee'),
    ]
    expect(roomCandidates(directory, ANA, BEN)).toEqual([
      { ...candidate(BEN, 'Ben'), reason: strings.debateSuggestion.askerLeftOut({ name: 'Ben' }) },
      { ...candidate(CY, 'Cy'), reason: strings.debateSuggestion.blocked({ name: 'Cy' }) },
      candidate(DEE, 'Dee'),
    ])
    expect(roomCandidates(directory, ANA, null).map((one) => one.reason)).toEqual([
      null,
      strings.debateSuggestion.blocked({ name: 'Cy' }),
      null,
    ])
  })
})
