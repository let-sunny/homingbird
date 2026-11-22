import type { ConversationId } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { RECENT_SHOWN, type SwitcherInput, switcherModel } from '../../src/models/switcher.ts'
import type { WaitingPlace } from '../../src/models/waiting.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, ROOM, channel, conversation, entry, member } from '../support/fixtures.ts'

const GROUP = 'conv_group0000000' as ConversationId

const waitingHere: WaitingPlace = {
  key: ROOM,
  conversationId: ROOM,
  text: strings.activity.withPeople({ names: 'Ben' }),
  href: `#/c/${ROOM}?draft=note_d1`,
  why: strings.activity.groups.drafts,
}

const input = (fields: Partial<SwitcherInput> = {}): SwitcherInput => ({
  query: '',
  chosen: 0,
  viewerId: ANA,
  directory: [entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy')],
  channels: [channel('billing', { joined: true })],
  conversations: [
    conversation({ lastActivityAt: 9 }),
    conversation({ id: GROUP, kind: 'group', participantIds: [ANA, BEN, CY], lastActivityAt: 5 }),
    conversation({ id: 'conv_old000000000' as ConversationId, archivedAt: 2, lastActivityAt: 20 }),
  ],
  members: new Map([
    [ANA, member(ANA, 'Ana')],
    [BEN, member(BEN, 'Ben')],
    [CY, member(CY, 'Cy')],
  ]),
  waiting: [],
  shortcut: '⌘K',
  ...fields,
})

describe('switcherModel', () => {
  it('lists what waits first, then recent rooms not already listed, newest first, none archived', () => {
    const model = switcherModel(input({ waiting: [waitingHere] }))
    expect(
      model.sections.map((section) => [section.title, section.options.map((option) => option.label)]),
    ).toEqual([
      [strings.switcher.waiting, [waitingHere.text]],
      [strings.switcher.recent, ['Ben, Cy']],
    ])
    expect(model.sections[0]!.options[0]).toEqual({
      key: `waiting:${ROOM}`,
      kind: 'waiting',
      label: waitingHere.text,
      detail: strings.activity.groups.drafts,
      target: { kind: 'href', href: waitingHere.href },
      id: 'switcher-option-0',
      chosen: true,
    })
    expect(model.chosenId).toBe('switcher-option-0')
    expect(model.footer).toBe(strings.switcher.footer({ open: '⌘K' }))
    expect(model.empty).toBeNull()
  })

  it('keeps the recent list short', () => {
    const rooms = Array.from({ length: RECENT_SHOWN + 2 }, (_, index) =>
      conversation({ id: `conv_r${index}`.padEnd(17, '0') as ConversationId, lastActivityAt: index }),
    )
    expect(switcherModel(input({ conversations: rooms })).sections[0]!.options).toHaveLength(RECENT_SHOWN)
  })

  it('lists people, channels and group messages for what is typed, in that order', () => {
    const model = switcherModel(input({ query: ' b ' }))
    expect(
      model.sections.map((section) => [section.key, section.options.map((option) => option.label)]),
    ).toEqual([
      ['people', ['Ben']],
      ['channels', ['#billing']],
      ['rooms', ['Ben, Cy']],
    ])
    expect(model.sections.map((section) => section.title)).toEqual([
      strings.navPeople,
      strings.channels,
      strings.switcher.rooms,
    ])
  })

  it('says when nothing matches, and when there is nothing to list yet', () => {
    const none = switcherModel(input({ query: 'zed ' }))
    expect(none).toMatchObject({ sections: [], chosenId: null, chosen: null })
    expect(none.empty).toBe(strings.switcher.none({ query: 'zed' }))
    expect(switcherModel(input({ conversations: [] })).empty).toBe(strings.switcher.nothingYet)
  })

  it('chooses exactly one option, wrapping around at either end', () => {
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 50 }), (chosen) => {
        const model = switcherModel(input({ query: 'b', chosen }))
        const options = model.sections.flatMap((section) => section.options)
        const picked = options.filter((option) => option.chosen)
        expect(picked).toHaveLength(1)
        expect(picked[0]!.id).toBe(model.chosenId)
        expect(options.indexOf(picked[0]!)).toBe(((chosen % 3) + 3) % 3)
        expect(model.chosen?.key).toBe(picked[0]!.key)
      }),
    )
  })

  it('names the field and the dialog', () => {
    expect(switcherModel(input())).toMatchObject({
      title: strings.switcher.title,
      label: strings.switcher.label,
      placeholder: strings.switcher.placeholder,
    })
  })
})
