import { getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import type { Participants } from '../../src/models/participants.ts'
import { strings } from '../../src/strings.ts'
import { renderThreadHead } from '../../src/views/thread-head.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, ROOM, channel } from '../support/fixtures.ts'

usingFakeDom()

const nobody: Participants = {
  id: 'people-room',
  label: '2 people',
  title: strings.participants.title,
  summary: 'June and Ben',
  people: [],
  note: null,
}

const host = (child: ReturnType<typeof renderThreadHead>) => {
  const element = document.createElement('div')
  document.body.append(element)
  for (const part of [child].flat(3) as unknown[])
    if (part !== false && part !== null) element.append(part as Node)
  return element
}

describe('renderThreadHead', () => {
  it('waits, then names the person with their profile and presence', () => {
    const { context } = testContext()
    expect(
      getByRole(host(renderThreadHead(context, { kind: 'loading', title: strings.loading })), 'heading')
        .textContent,
    ).toBe(strings.loading)
    const shown = host(
      renderThreadHead(context, {
        kind: 'people',
        title: 'Ben',
        profile: 'Billing',
        presence: {
          person: { isOn: true, label: strings.presenceOf.online({ name: 'Ben' }) },
          agent: { state: 'on', label: strings.presenceOf.agentAwake({ name: 'Ben' }) },
          words: strings.presenceWords.online.on,
        },
        people: nobody,
        showsCount: false,
        profileOf: BEN,
        mute: null,
      }),
    )
    expect(getByRole(shown, 'button', { name: 'Ben' }).getAttribute('popovertarget')).toBe('profile-card')
    expect(getByRole(shown, 'button', { name: 'Ben' }).dataset.profile).toBe(BEN)
    expect(textOf(shown)).toContain('Billing')
    expect(getByRole(shown, 'img', { name: strings.presenceOf.online({ name: 'Ben' }) })).toBeTruthy()
    expect(
      getByRole(shown, 'img', { name: strings.presenceOf.agentAwake({ name: 'Ben' }) }).className,
    ).toContain('is-on')
    expect(getByRole(shown, 'heading').className).toContain('is-whole')
    expect(getByRole(shown, 'heading').querySelector('.presence-dots')).toBeNull()
    expect(
      textOf(
        host(
          renderThreadHead(context, {
            kind: 'people',
            title: 'Team',
            profile: null,
            presence: null,
            people: nobody,
            showsCount: false,
            profileOf: null,
            mute: null,
          }),
        ),
      ),
    ).not.toContain('Billing')
  })

  it('shows a channel with its counts and controls, and an archived room as archived', () => {
    const { context } = testContext()
    const shown = host(
      renderThreadHead(context, {
        kind: 'channel',
        title: '#billing',
        archived: false,
        channel: channel('billing', { joined: true }),
        agentState: { state: 'off', until: null, label: 'Billing helper: not connected' },
        people: { ...nobody, label: '3 members' },
        answerCount: '1 answers',
        slackLink: null,
        mute: null,
      }),
    )
    expect(getByRole(shown, 'status').textContent).toBe('Billing helper: not connected')
    expect(getByRole(shown, 'switch', { name: strings.answerHere })).toBeTruthy()
    expect(getByRole(shown, 'heading').textContent).toBe('#billing')
    expect(queryByRole(shown, 'button', { name: strings.leaveChannel })).toBeNull()
    getByRole(shown, 'button', { name: strings.roomMore({ channel: '#billing' }) }).click()
    expect(getByRole(shown, 'button', { name: strings.leaveChannel })).toBeTruthy()
    const archived = host(
      renderThreadHead(context, {
        kind: 'channel',
        title: '#old',
        archived: true,
        channel: null,
        agentState: null,
        people: nobody,
        answerCount: null,
        slackLink: null,
        mute: null,
      }),
    )
    expect(textOf(archived)).toContain(strings.archived)
  })

  it('says how many people are in a group message, and lists each with their part behind its count and its name', () => {
    const { context } = testContext()
    const shown = host(
      renderThreadHead(context, {
        kind: 'people',
        title: 'Ben, Billing helper +1',
        profile: null,
        presence: null,
        people: {
          ...nobody,
          label: '4 people',
          summary: 'June, Ben, Billing helper, and Cy',
          people: [
            { memberId: ANA, name: 'June', you: true, roles: ['Manages #billing'] },
            { memberId: BEN, name: 'Ben', you: false, roles: ['Asked this question'] },
            { memberId: CY, name: 'Billing helper', you: false, roles: [] },
          ],
          note: 'Whoever manages #billing later joins too.',
        },
        showsCount: true,
        profileOf: null,
        mute: null,
      }),
    )
    const list = shown.querySelector<HTMLElement>('.people-list')!
    expect(list.getAttribute('popover')).toBe('auto')
    expect(list.className).toContain('action-menu')
    const count = getByRole(shown, 'button', { name: '4 people' })
    const title = getByRole(shown, 'button', { name: 'Ben, Billing helper +1' })
    for (const opener of [count, title]) {
      expect(opener.getAttribute('popovertarget')).toBe(list.id)
      expect(opener.getAttribute('title')).toBe('June, Ben, Billing helper, and Cy')
    }
    expect(getByRole(shown, 'heading').contains(title)).toBe(true)
    const listed = [...list.querySelectorAll('li')].map((item) => textOf(item))
    expect(listed).toEqual([
      `June ${strings.youMark}Manages #billing`,
      'BenAsked this question',
      'Billing helper',
    ])
    expect(textOf(list)).toContain('Whoever manages #billing later joins too.')
  })

  it('opens a direct message’s list from its name alone, and a channel’s from its member count', () => {
    const { context } = testContext()
    const direct = host(
      renderThreadHead(context, {
        kind: 'people',
        title: 'Ben',
        profile: null,
        presence: null,
        people: nobody,
        showsCount: false,
        profileOf: null,
        mute: null,
      }),
    )
    expect(queryByRole(direct, 'button', { name: '2 people' })).toBeNull()
    expect(getByRole(direct, 'button', { name: 'Ben' }).getAttribute('popovertarget')).toBe(nobody.id)
    const room = host(
      renderThreadHead(context, {
        kind: 'channel',
        title: '#billing',
        archived: false,
        channel: channel('billing'),
        agentState: null,
        people: { ...nobody, label: '3 members' },
        answerCount: '1 answers',
        slackLink: null,
        mute: null,
      }),
    )
    expect(getByRole(room, 'button', { name: '3 members' }).getAttribute('popovertarget')).toBe(nobody.id)
    expect(textOf(room)).toContain('1 answers')
    const archived = host(
      renderThreadHead(context, {
        kind: 'channel',
        title: '#old',
        archived: true,
        channel: null,
        agentState: null,
        people: nobody,
        answerCount: null,
        slackLink: null,
        mute: null,
      }),
    )
    expect(getByRole(archived, 'button', { name: '2 people' })).toBeTruthy()
  })

  it('marks a muted conversation and offers to lift the mute, beside a person or a channel', () => {
    const { context, called } = testContext()
    const mute = {
      conversationId: ROOM,
      muted: true,
      label: 'Unmute Ben',
      mark: strings.mute.muted,
      hint: strings.mute.hint,
    }
    const person = host(
      renderThreadHead(context, {
        kind: 'people',
        title: 'Ben',
        profile: null,
        presence: null,
        people: nobody,
        showsCount: false,
        profileOf: null,
        mute,
      }),
    )
    expect(getByRole(person, 'heading').textContent).toContain(strings.mute.muted)
    getByRole(person, 'button', { name: 'Unmute Ben' }).click()
    expect(called('setMuted').map((call) => call.args)).toEqual([[ROOM, false]])
    const room = host(
      renderThreadHead(context, {
        kind: 'channel',
        title: '#billing',
        archived: false,
        channel: channel('billing', { joined: true }),
        agentState: null,
        people: nobody,
        answerCount: null,
        slackLink: null,
        mute: { ...mute, muted: false, label: 'Mute #billing', mark: null },
      }),
    )
    expect(getByRole(room, 'heading').textContent).not.toContain(strings.mute.muted)
    getByRole(room, 'button', { name: 'Mute #billing' }).click()
    expect(called('setMuted').map((call) => call.args)).toEqual([
      [ROOM, false],
      [ROOM, true],
    ])
  })
})
