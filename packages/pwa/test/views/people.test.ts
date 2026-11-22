import { lifetime } from '@homingbird/ui'
import { allByRole, fire, getByRole, getByText, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { peopleView } from '../../src/views/people.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, OPS, TEAM, channel, entry, group, me, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const loaded = (
  context: ReturnType<typeof testContext>['context'],
  directory: ReturnType<typeof entry>[],
) => {
  context.state.directory.set(directory)
  context.state.directoryLoaded.set(true)
}

describe('peopleView', () => {
  it('brings the person a profile card asked for into view once, and each face opens that person’s card', () => {
    const { context, page } = testContext(`#/people?person=${BEN}`)
    const shown = mount(peopleView(context, lifetime(), me()))
    loaded(context, [entry(BEN, 'Ben'), entry(CY, 'Cy')])
    const ben = shown.querySelector<HTMLElement>(`.person[data-member-id="${BEN}"]`)!
    expect(ben.classList.contains('is-focused')).toBe(true)
    expect(shown.querySelector(`.person[data-member-id="${CY}"]`)!.classList.contains('is-focused')).toBe(
      false,
    )
    page.runFrames()
    expect(document.activeElement).toBe(ben)
    document.body.focus()
    context.state.directory.set([entry(BEN, 'Ben'), entry(CY, 'Cy', { relation: 'contact' })])
    page.runFrames()
    expect(document.activeElement).not.toBe(shown.querySelector(`.person[data-member-id="${BEN}"]`))
    const face = getByRole(shown, 'button', { name: strings.profileCard.open({ name: 'Cy' }) })
    expect(face.getAttribute('popovertarget')).toBe('profile-card')
    expect(face.dataset.profile).toBe(CY)
  })

  it('loads people and channels, and offers a retry when people could not load', () => {
    const { context, called } = testContext()
    const shown = peopleView(context, lifetime(), me())
    expect(called('loadKnownChannels')).toHaveLength(1)
    expect(textOf(shown)).toContain(strings.loading)
    called('loadPeople')[0]!.then!.failed!({ _tag: 'Unavailable', message: 'down' })
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('loadPeople')).toHaveLength(2)
    expect(textOf(shown)).toContain(strings.loading)
  })

  it('lists people, agents awake first, and filters them by what is typed and the channel chosen', () => {
    const { context } = testContext()
    const shown = peopleView(context, lifetime(), me({ contactMode: 'contacts' }))
    expect(textOf(shown)).toContain(strings.contactsModeNotice)
    context.state.channels.set([channel('billing')])
    loaded(context, [
      entry(CY, 'Cy'),
      entry(BEN, 'Ben', { presence: { humanOnline: false, agentOnline: true }, channels: ['billing'] }),
    ])
    expect(
      allByRole(shown, 'listitem')
        .filter((item) => item.classList.contains('person'))
        .map((item) => item.querySelector('strong')!.textContent),
    ).toEqual(['Ben', 'Cy'])
    fire.select(getByRole(shown, 'combobox', { name: strings.peopleChannelFilter }), 'billing')
    expect(shown.querySelectorAll('.person')).toHaveLength(1)
    fire.select(getByRole(shown, 'combobox', { name: strings.peopleChannelFilter }), '')
    fire.type(getByRole(shown, 'searchbox'), 'nobody')
    expect(textOf(shown)).toContain(strings.noPeople)
  })

  it('offers what each relation allows, and asks for it', () => {
    const { context, called } = testContext()
    const shown = mount(peopleView(context, lifetime(), me({ contactMode: 'contacts' })))
    loaded(context, [
      entry(ANA, 'Ana', { relation: 'self' }),
      entry(BEN, 'Ben', { relation: 'request_received', agentIntroduction: ['Answers billing.'] }),
      entry(CY, 'Cy', { relation: 'blocked' }),
    ])
    const ben = shown.querySelector(`[data-member-id="${BEN}"]`)!
    expect(getByText(ben, 'Answers billing.')).toBeTruthy()
    for (const label of [strings.message, strings.acceptContact, strings.declineRequest])
      getByRole(ben.querySelector('.person-actions')!, 'button', { name: label }).click()
    const more = getByRole(ben, 'button', { name: strings.personMore({ name: 'Ben' }) })
    const menu = ben.querySelector<HTMLElement>(`#${more.getAttribute('popovertarget')}`)!
    expect(menu.getAttribute('popover')).toBe('auto')
    fire.event(ben.querySelector('.person-email'), 'contextmenu')
    expect(menu.matches(':popover-open')).toBe(true)
    getByRole(menu, 'menuitem', { name: strings.block }).click()
    expect(textOf(ben)).toContain(strings.profileAboutOther)
    expect(textOf(shown.querySelector(`[data-member-id="${ANA}"]`)!)).toContain(strings.profileAbout)
    getByRole(shown.querySelector(`[data-member-id="${CY}"]`)!, 'button', { name: strings.unblock }).click()
    expect(shown.querySelector(`[data-member-id="${ANA}"] .person-actions`)!.children).toHaveLength(0)
    const asked = [
      'openConversationWith',
      'acceptContact',
      'removeContact',
      'blockMember',
      'unblockMember',
    ].map((name) => called(name).map((call) => call.args[0]))
    expect(asked).toEqual([[BEN], [BEN], [BEN], [BEN], [CY]])
  })

  it('offers to add, cancel or remove a contact, each for the right person', () => {
    const { context, called } = testContext()
    const shown = peopleView(context, lifetime(), me({ contactMode: 'contacts' }))
    loaded(context, [
      entry(ANA, 'Ana', { relation: 'none' }),
      entry(BEN, 'Ben', { relation: 'request_sent' }),
      entry(CY, 'Cy', { relation: 'contact' }),
    ])
    getByRole(shown, 'button', { name: strings.addContact }).click()
    getByRole(shown, 'button', { name: strings.cancelRequest }).click()
    getByRole(shown, 'button', { name: strings.removeContact }).click()
    expect(called('requestContact').map((call) => call.args[0])).toEqual([ANA])
    expect(called('removeContact').map((call) => call.args[0])).toEqual([BEN, CY])
  })

  it('filters by a group as the server lists its members, and links each person’s groups', () => {
    const { context, called } = testContext()
    const shown = peopleView(context, lifetime(), me())
    expect(called('loadGroups')).toHaveLength(1)
    loaded(context, [entry(BEN, 'Ben'), entry(CY, 'Cy')])
    context.state.groups.set([group(TEAM, { name: 'Finance', memberIds: [CY] }), group(OPS, { name: 'Ops' })])
    expect(getByRole(shown, 'link', { name: 'Finance' }).getAttribute('href')).toBe(
      '#/group/grp_team00000000',
    )
    const filter = getByRole(shown, 'combobox', { name: strings.groups.filter })
    fire.select(filter, OPS)
    fire.select(filter, TEAM)
    expect(textOf(shown)).toContain(strings.loading)
    expect(called('listPeopleInGroup').map((call) => call.args)).toEqual([[OPS], [TEAM]])
    called('listPeopleInGroup')[0]!.then!.done!([BEN])
    expect(textOf(shown)).toContain(strings.loading)
    called('listPeopleInGroup')[1]!.then!.done!([CY])
    expect(textOf(shown)).toContain('Cy')
    expect(textOf(shown)).not.toContain('Ben')
    fire.select(filter, '')
    expect(textOf(shown)).toContain('Ben')
    expect(called('listPeopleInGroup')).toHaveLength(2)
  })

  it('offers no group filter and no group links while groups are off', () => {
    const { context } = testContext()
    context.state.serverInfo.set(serverInfo())
    const shown = peopleView(context, lifetime(), me())
    loaded(context, [entry(CY, 'Cy')])
    context.state.groups.set([group(TEAM, { name: 'Finance', memberIds: [CY] })])
    expect(shown.querySelector('select[name="group"]')).toBeNull()
    expect(shown.querySelector('.group-chips')).toBeNull()
  })

  it('links each person one may write to to a new message with them chosen, to add others to', () => {
    const { context } = testContext()
    const shown = peopleView(context, lifetime(), me())
    loaded(context, [
      entry(ANA, 'Ana', { relation: 'self', canMessage: false }),
      entry(BEN, 'Ben'),
      entry(CY, 'Cy', { canMessage: false }),
    ])
    expect(shown.querySelector('.group-start')).toBeNull()
    expect(shown.querySelector(`[data-member-id="${ANA}"] .with-others`)).toBeNull()
    expect(shown.querySelector(`[data-member-id="${CY}"] .with-others`)).toBeNull()
    const link = getByRole(shown, 'link', { name: 'New message to Ben and others' })
    expect(link.getAttribute('href')).toBe(`#/new?to=${BEN}`)
    expect(link.textContent).toBe(strings.newMessage.withOthers)
  })
})
