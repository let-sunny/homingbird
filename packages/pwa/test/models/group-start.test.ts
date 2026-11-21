import { type MemberId, RECIPIENTS_MAX } from '@homingbird/protocol'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type GroupStartInput,
  groupStartModel,
  participantsToStart,
  toggledChoice,
} from '../../src/models/group-start.ts'
import { strings, useLanguage } from '../../src/strings.ts'
import { ANA, BEN, CY, conversation, entry } from '../support/fixtures.ts'

const DEE = 'mem_dee000000000' as MemberId
const EVE = 'mem_eve000000000' as MemberId

const directory = [
  entry(ANA, 'Ana', { relation: 'self', canMessage: false }),
  entry(BEN, 'Ben'),
  entry(CY, 'Cy'),
  entry(DEE, 'Dee'),
  entry(EVE, 'Eve', { relation: 'blocked', canMessage: false }),
]

const base: GroupStartInput = {
  directory,
  conversations: [],
  viewerId: ANA,
  chosen: [],
  starting: false,
  draftRequests: true,
}

const many = (count: number): MemberId[] =>
  Array.from({ length: count }, (_, index) => `mem_many${String(index).padStart(8, '0')}` as MemberId)

afterEach(() => useLanguage('en'))

describe('groupStartModel', () => {
  it('offers asking one’s agent for a draft only while the server lets people ask', () => {
    expect(groupStartModel(base)!.intro).toBe(strings.groupStart.intro)
    expect(groupStartModel({ ...base, draftRequests: false })!.intro).toBe(
      strings.groupStart.introWithoutRequests,
    )
    expect(strings.groupStart.introWithoutRequests).not.toMatch(/agent/)
  })

  it('offers nothing when fewer than two people may be messaged', () => {
    expect(groupStartModel({ ...base, directory: directory.slice(0, 2) })).toBeNull()
    expect(groupStartModel({ ...base, directory: [] })).toBeNull()
  })

  it('offers every person one may message, and no one else, before anyone is chosen', () => {
    const model = groupStartModel(base)!
    expect(model).toMatchObject({
      title: strings.groupStart.title,
      collapsed: strings.groupStart.collapsed,
      intro: strings.groupStart.intro,
      count: '0 people chosen',
      status: strings.groupStart.none,
      chips: [],
      full: null,
      start: { label: strings.groupStart.start, enabled: false },
      clear: null,
    })
    expect([...model.toggles.keys()]).toEqual([BEN, CY, DEE])
    expect(model.toggles.get(BEN)).toEqual({
      text: strings.groupStart.choose,
      label: 'Add Ben to the group message',
      pressed: false,
      disabled: false,
    })
  })

  it('says a person is added, and how to remove them, once chosen', () => {
    expect(groupStartModel({ ...base, chosen: [BEN] })!.toggles.get(BEN)).toEqual({
      text: strings.groupStart.added,
      label: 'Ben added (remove)',
      pressed: true,
      disabled: false,
    })
  })

  it('never offers a channel’s agent, even one the server said may be messaged', () => {
    const agent = entry('mem_agent0000000' as MemberId, 'Payments wiki')
    const shown = [...directory, { ...agent, member: { ...agent.member, kind: 'channel_agent' as const } }]
    expect([...groupStartModel({ ...base, directory: shown })!.toggles.keys()]).toEqual([BEN, CY, DEE])
  })

  it('asks for one more person after the first, and starts with two or more, named as a list', () => {
    const one = groupStartModel({ ...base, chosen: [CY] })!
    expect(one).toMatchObject({
      count: '1 person chosen',
      status: strings.groupStart.needMore,
      chips: [{ memberId: CY, name: 'Cy', removeLabel: 'Remove Cy' }],
      start: { enabled: false },
      clear: strings.groupStart.clear,
    })
    expect(one.toggles.get(CY)?.pressed).toBe(true)
    const three = groupStartModel({ ...base, chosen: [DEE, BEN, CY] })!
    expect(three.status).toBe('A group message with Dee, Ben, and Cy.')
    expect(three.chips.map((chip) => chip.name)).toEqual(['Dee', 'Ben', 'Cy'])
    expect(three.start).toEqual({ label: strings.groupStart.start, enabled: true })
  })

  it('drops whoever may no longer be messaged, and counts each person once', () => {
    const model = groupStartModel({ ...base, chosen: [BEN, EVE, BEN, ANA] })!
    expect(model.chips.map((chip) => chip.memberId)).toEqual([BEN])
    expect(participantsToStart({ ...base, chosen: [BEN, EVE, BEN, ANA] })).toBeNull()
  })

  it('opens the group room there already is with exactly the people chosen, and only that one', () => {
    const room = conversation({ kind: 'group', participantIds: [ANA, BEN, CY] })
    const conversations = [room]
    expect(groupStartModel({ ...base, conversations, chosen: [CY, BEN] })!.existing).toEqual({
      text: strings.groupStart.existing,
      label: strings.groupStart.open,
      href: `#/c/${room.id}`,
    })
    expect(groupStartModel({ ...base, conversations, chosen: [BEN, CY, DEE] })!.existing).toBeNull()
    expect(groupStartModel({ ...base, conversations, chosen: [BEN] })!.existing).toBeNull()
    expect(groupStartModel({ ...base, chosen: [BEN, CY] })!.existing).toBeNull()
  })

  it('holds the start while the conversation is being started', () => {
    const model = groupStartModel({ ...base, chosen: [BEN, CY], starting: true })!
    expect(model.start).toEqual({ label: strings.groupStart.starting, enabled: false })
    expect([...model.toggles.values()].every((toggle) => toggle.disabled)).toBe(true)
  })

  it('takes no one more once a conversation is full, while those chosen can still be taken out', () => {
    const people = many(RECIPIENTS_MAX + 1)
    const full = groupStartModel({
      ...base,
      directory: people.map((id, index) => entry(id, `Person ${index}`)),
      chosen: people,
      starting: false,
    })!
    expect(full.chips).toHaveLength(RECIPIENTS_MAX)
    expect(full.full).toBe(`A group message holds at most ${RECIPIENTS_MAX} other people.`)
    expect(full.toggles.get(people[0]!)).toMatchObject({ pressed: true, disabled: false })
    expect(full.toggles.get(people[RECIPIENTS_MAX]!)).toMatchObject({ pressed: false, disabled: true })
  })

  it('speaks Korean when the person chose it', () => {
    useLanguage('ko')
    const model = groupStartModel({ ...base, chosen: [BEN, CY] })!
    expect(model.count).toBe('2명 골랐어요')
    expect(model.status).toBe(
      strings.groupStart.with({ names: new Intl.ListFormat('ko').format(['Ben', 'Cy']) }),
    )
  })
})

describe('participantsToStart', () => {
  it('names the people chosen once there are two', () => {
    expect(participantsToStart(base)).toBeNull()
    expect(participantsToStart({ ...base, chosen: [BEN] })).toBeNull()
    expect(participantsToStart({ ...base, chosen: [CY, BEN] })).toEqual([CY, BEN])
  })
})

describe('toggledChoice', () => {
  it('adds a person at the end and takes them out again', () => {
    expect(toggledChoice([BEN], CY)).toEqual([BEN, CY])
    expect(toggledChoice([BEN, CY], BEN)).toEqual([CY])
  })

  it('never adds anyone to a full conversation', () => {
    const full = many(RECIPIENTS_MAX)
    expect(toggledChoice(full, BEN)).toBe(full)
  })

  it('returns to where it started when the same person is toggled twice, and never repeats anyone', () => {
    const people = [BEN, CY, DEE, EVE]
    fc.assert(
      fc.property(fc.uniqueArray(fc.constantFrom(...people)), fc.constantFrom(...people), (chosen, one) => {
        expect(toggledChoice(toggledChoice(chosen, one), one).length).toBe(chosen.length)
        const next = toggledChoice(chosen, one)
        expect(new Set(next).size).toBe(next.length)
      }),
    )
  })
})
