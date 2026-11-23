import type { MemberId } from '@homingbird/protocol'
import { h, lifetime } from '@homingbird/ui'
import { getByRole, isPopoverOpen, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { opensProfile, profileCardHost, profileName } from '../../src/views/profile-card.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import {
  ANA,
  BEN,
  CY,
  TEAM,
  channel,
  debate,
  entry,
  everything,
  group,
  managersOf,
  me,
  member,
} from '../support/fixtures.ts'

usingFakeDom()

const AGENT = 'mem_agent0000000' as MemberId

const shown = () => {
  const test = testContext('#/people')
  const { state } = test.context
  state.serverInfo.set(everything())
  state.session.set(me())
  state.directory.set([
    entry(ANA, 'Ana'),
    {
      ...entry(BEN, 'Ben', { presence: { humanOnline: true, agentOnline: false } }),
      member: member(BEN, 'Ben', { profile: 'Runs billing.' }),
    },
    { ...entry(CY, 'Cy'), member: member(CY, 'Cy', { status: 'deactivated' }) },
  ])
  state.groups.set([
    group(TEAM, { name: 'Payments', memberIds: [BEN] }),
    managersOf('billing', { memberIds: [BEN] }),
  ])
  state.channels.set([
    channel('billing', {
      agent: { id: AGENT, name: 'Billing helper', presence: { humanOnline: false, agentOnline: true } },
    }),
  ])
  const life = lifetime()
  const card = mount(profileCardHost(test.context, life, me()))
  return { ...test, card, life }
}

const isOpen = (card: HTMLElement): boolean => isPopoverOpen(card as never)

describe('profileCardHost', () => {
  it('opens a colleague’s card from their name, with their presence, groups and About, and Message opens the direct message', () => {
    const { card } = shown()
    const name = mount(profileName(BEN, 'Ben'))
    expect(name.getAttribute('popovertarget')).toBe('profile-card')
    name.click()
    expect(isOpen(card)).toBe(true)
    expect(card.getAttribute('role')).toBe('dialog')
    expect(card.getAttribute('aria-label')).toBe(strings.profileCard.label({ name: 'Ben' }))
    expect(name.style.getPropertyValue('anchor-name')).toBe('--profile-card')
    expect(textOf(card)).toContain(strings.presenceWords.online.off)
    expect(textOf(card)).toContain(strings.profileCard.groups({ groups: 'Payments' }))
    expect(textOf(card)).toContain('Runs billing.')
    expect(
      (card.querySelector('.profile-head .turning-bird') as HTMLElement).style.getPropertyValue(
        '--turn-sheet',
      ),
    ).toMatch(/^url\("data:image\/png;fake,624x39"\)$/)
    expect(getByRole(card, 'link', { name: strings.profileCard.openInPeople }).getAttribute('href')).toBe(
      `#/people?person=${BEN}`,
    )
    const message = getByRole(card, 'link', { name: strings.message })
    expect(message.getAttribute('href')).toBe(`#/new?to=${BEN}`)
    message.click()
    expect(isOpen(card)).toBe(false)
  })

  it('moves to another name while open, closes on a second press of the same one, and on a new place', () => {
    const { card, context, page } = shown()
    page.state.anchors = true
    const ben = mount(profileName(BEN, 'Ben'))
    const ana = mount(h('button', { type: 'button', ...opensProfile(ANA) }, 'Ana'))
    ben.click()
    ana.click()
    expect(isOpen(card)).toBe(true)
    expect(textOf(card)).toContain(strings.youMark)
    expect(card.querySelector('.profile-message')).toBeNull()
    expect(ben.style.getPropertyValue('anchor-name')).toBe('')
    expect(ana.style.getPropertyValue('anchor-name')).toBe('--profile-card')
    ana.click()
    expect(isOpen(card)).toBe(false)
    ben.click()
    getByRole(card, 'link', { name: strings.profileCard.openInPeople }).click()
    expect(isOpen(card)).toBe(false)
    ben.click()
    context.state.route.set({ name: 'channels' })
    expect(isOpen(card)).toBe(false)
    context.state.route.set({ name: 'home' })
    expect(isOpen(card)).toBe(false)
    document.body.click()
    expect(isOpen(card)).toBe(false)
  })

  it('gives a channel’s agent its channel and state, and someone who left no actions', () => {
    const { card } = shown()
    mount(profileName(AGENT, 'Billing helper')).click()
    expect(textOf(card)).toContain(strings.participants.channelAgent({ channel: '#billing' }))
    expect(textOf(card)).toContain(strings.channelAgentState.awake({ agent: 'Billing helper' }))
    expect(textOf(card)).toContain(strings.profileCard.managedBy({ names: 'Ben' }))
    expect(card.querySelector('button, a')).toBeNull()
    card.hidePopover()
    mount(profileName(CY, 'Cy')).click()
    expect(textOf(card)).toContain(strings.formerMember)
    expect(card.querySelector('button, a')).toBeNull()
  })

  it('names what the member is in the flock on screen', () => {
    const { card, context } = shown()
    const room = debate({ participants: [{ memberId: BEN, agentId: null, agentName: 'Desk', joinedAt: 1 }] })
    context.state.shownDebate.set(room)
    context.state.route.set({ name: 'debate', id: room.id, tab: null })
    mount(profileName(BEN, 'Ben')).click()
    expect([...card.querySelectorAll('.profile-roles li')].map((role) => role.textContent)).toEqual([
      strings.participants.takesPartThrough({ agent: 'Desk' }),
    ])
  })

  it('shows what a note’s author details say, and opens inside a dialog a name sits in', () => {
    const { card } = shown()
    mount(
      h(
        'div',
        { id: 'author-n1' },
        h('p', {}, 'Ben’s agent wrote this'),
        h('p', {}, ''),
        h('p', {}, 'Sent at noon'),
      ),
    )
    const dialog = mount(h('dialog', {}))
    const face = h('button', { type: 'button', ...opensProfile(BEN, 'author-n1') }, 'Ben')
    dialog.append(face)
    face.click()
    expect(card.parentElement).toBe(dialog)
    expect([...card.querySelectorAll('.profile-note p')].map((line) => line.textContent)).toEqual([
      'Ben’s agent wrote this',
      'Sent at noon',
    ])
    card.hidePopover()
    mount(h('button', { type: 'button', ...opensProfile(BEN, 'author-gone') }, 'Ben')).click()
    expect(card.parentElement).toBe(document.body)
    expect(card.querySelector('.profile-note')).toBeNull()
  })
})
