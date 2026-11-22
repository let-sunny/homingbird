import type { Relation } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { type PeopleInput, peopleModel } from '../../src/models/people.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, OPS, TEAM, channel, entry, group, managersOf } from '../support/fixtures.ts'

const base: PeopleInput = {
  contactMode: 'open',
  directory: [],
  loaded: true,
  failed: false,
  query: '',
  channelFilter: '',
  channels: [],
  charactersOn: true,
  groups: [],
  groupsOn: true,
  groupFilter: '',
  groupMembers: null,
}

const list = (input: Partial<PeopleInput>) => {
  const model = peopleModel({ ...base, ...input }).list
  return model.kind === 'people' ? model.people : []
}

describe('peopleModel', () => {
  it('waits, offers to try again after a failure, and says when nobody matches', () => {
    expect(peopleModel({ ...base, loaded: false }).list).toEqual({ kind: 'loading' })
    expect(peopleModel({ ...base, loaded: false, failed: true }).list).toEqual({ kind: 'failed' })
    expect(peopleModel(base).list).toEqual({ kind: 'empty', text: strings.noPeople })
  })

  it('tells about contacts mode and offers a channel filter only when there are channels', () => {
    expect(peopleModel(base).contactsNotice).toBeNull()
    expect(peopleModel({ ...base, contactMode: 'contacts' }).contactsNotice).toBe(strings.contactsModeNotice)
    expect(peopleModel(base).channelFilter).toBeNull()
    expect(
      peopleModel({ ...base, channels: [channel('billing')], channelFilter: 'billing' }).channelFilter,
    ).toEqual([
      { value: '', label: strings.anyChannel, selected: false },
      { value: 'billing', label: '#billing', selected: true },
    ])
  })

  it('marks the person an “Open in People” asked for, and no one else', () => {
    const directory = [entry(BEN, 'Ben'), entry(CY, 'Cy')]
    const focused = (person?: string) => list({ directory, person }).map((card) => [card.name, card.focused])
    expect(focused(CY)).toEqual([
      ['Ben', false],
      ['Cy', true],
    ])
    expect(focused()).toEqual([
      ['Ben', false],
      ['Cy', false],
    ])
  })

  it('lists people whose agent is awake first, then by name, matching the search and the channel', () => {
    const directory = [
      entry(CY, 'Cy', { channels: ['billing'] }),
      entry(BEN, 'Ben', { presence: { humanOnline: false, agentOnline: true }, channels: ['billing'] }),
      entry(ANA, 'Ana', { relation: 'self' }),
    ]
    expect(list({ directory }).map((person) => person.name)).toEqual(['Ben', 'Ana', 'Cy'])
    expect(list({ directory, query: ' BEN ' }).map((person) => person.name)).toEqual(['Ben'])
    expect(list({ directory, channelFilter: 'billing' }).map((person) => person.name)).toEqual(['Ben', 'Cy'])
  })

  it('filters by the team chosen once the server listed its members, and offers teams only where they are on', () => {
    const directory = [entry(BEN, 'Ben'), entry(CY, 'Cy')]
    const groups = [group(TEAM, { name: 'Finance' }), managersOf('ops')]
    expect(peopleModel({ ...base, groups, groupFilter: TEAM }).groupFilter).toEqual([
      { value: '', label: strings.groups.any, selected: false },
      { value: TEAM, label: 'Finance', selected: true },
    ])
    expect(peopleModel({ ...base, groups, groupsOn: false }).groupFilter).toBeNull()
    expect(peopleModel(base).groupFilter).toBeNull()
    expect(peopleModel({ ...base, groups: [managersOf('ops')] }).groupFilter).toBeNull()
    expect(peopleModel({ ...base, directory, groupFilter: TEAM }).list).toEqual({ kind: 'loading' })
    expect(
      list({ directory, groupFilter: TEAM, groupMembers: new Set([CY]) }).map((one) => one.name),
    ).toEqual(['Cy'])
    expect(list({ directory, groupFilter: TEAM, groupsOn: false }).map((one) => one.name)).toEqual([
      'Ben',
      'Cy',
    ])
  })

  it('shows the teams a person is in, linking to each, and none while groups are off', () => {
    const groups = [
      group(TEAM, { name: 'Finance', memberIds: [BEN] }),
      group(OPS, { name: 'Ops', memberIds: [CY] }),
      managersOf('billing', { memberIds: [BEN] }),
    ]
    const [ben] = list({ directory: [entry(BEN, 'Ben')], groups })
    expect(ben!.groups).toEqual([{ label: 'Finance', href: '#/group/grp_team00000000' }])
    expect(list({ directory: [entry(BEN, 'Ben')], groups, groupsOn: false })[0]!.groups).toEqual([])
  })

  it('shows a person’s relation, channels, profile and agent introduction', () => {
    const [person] = list({
      contactMode: 'contacts',
      directory: [
        entry(BEN, 'Ben', {
          relation: 'contact',
          channels: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
          agentIntroduction: ['Answers billing questions.'],
        }),
      ],
      channels: [channel('h', { joined: true })],
    })
    expect(person!.relation).toEqual({ kind: 'contact', text: strings.relation.contact })
    expect(person!.channels).toEqual({
      first: ['h', 'a', 'b', 'c', 'd', 'e'],
      rest: ['f', 'g'],
      more: strings.moreChannels({ count: 2 }),
    })
    expect(person!.profile).toEqual({
      open: false,
      summary: strings.profileAboutOther,
      text: strings.noProfile,
    })
    expect(person!.agentIntroduction).toEqual(['Answers billing questions.'])
    const [plain] = list({
      directory: [entry(BEN, 'Ben', { member: { ...entry(BEN, 'Ben').member, profile: 'Hi' } })],
    })
    expect(plain!.relation).toBeNull()
    expect(plain!.channels).toBeNull()
    expect(plain!.profile).toEqual({ open: true, summary: strings.profileAboutOther, text: 'Hi' })
    expect(plain!.agentIntroduction).toEqual([])
  })

  it('draws a blocked person as blocked and a person nobody is at as away', () => {
    const states = list({
      directory: [
        entry(BEN, 'Ben', { relation: 'blocked' }),
        entry(CY, 'Cy', { presence: { humanOnline: true, agentOnline: false } }),
        entry(ANA, 'Dee'),
      ],
    }).map((person) => person.avatar.state)
    expect(states).toEqual(['blocked', 'idle', 'offline'])
  })

  it('offers what each relation allows, blocking behind the card’s menu', () => {
    const actionsFor = (relation: Relation, mode: PeopleInput['contactMode'], canMessage = true) => {
      const [card] = list({ contactMode: mode, directory: [entry(BEN, 'Ben', { relation, canMessage })] })
      return [...card!.actions, ...(card!.more?.actions ?? [])].map((action) => action.kind)
    }
    const [ben] = list({ directory: [entry(BEN, 'Ben')] })
    expect(ben!.actions.map((action) => action.kind)).toEqual(['message'])
    expect(ben!.more).toEqual({
      label: strings.personMore({ name: 'Ben' }),
      actions: [{ kind: 'block', label: strings.block, style: 'danger', hint: null }],
    })
    expect(ben!.withOthers).toEqual({
      text: strings.newMessage.withOthers,
      label: strings.newMessage.withOthersLabel({ name: 'Ben' }),
      href: `#/new?to=${BEN}`,
    })
    const [self] = list({ directory: [entry(BEN, 'Ben', { relation: 'self' })] })
    expect(self!.more).toBeNull()
    expect(self!.withOthers).toBeNull()
    expect(self!.profile.summary).toBe(strings.profileAbout)
    expect(actionsFor('self', 'open')).toEqual([])
    expect(actionsFor('blocked', 'open')).toEqual(['unblock'])
    expect(actionsFor('none', 'open')).toEqual(['message', 'block'])
    expect(actionsFor('none', 'contacts', false)).toEqual(['request', 'block'])
    expect(actionsFor('request_received', 'contacts')).toEqual(['message', 'accept', 'decline', 'block'])
    expect(actionsFor('request_sent', 'contacts')).toEqual(['message', 'cancel', 'block'])
    expect(actionsFor('contact', 'contacts')).toEqual(['message', 'remove', 'block'])
    const [request] = list({
      contactMode: 'contacts',
      directory: [entry(BEN, 'Ben', { canMessage: false })],
    })[0]!.actions
    expect(request).toEqual({
      kind: 'request',
      label: strings.addContact,
      style: null,
      hint: strings.addContactHint({ name: 'Ben' }),
    })
  })
})
