import { getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { renderThreadHead } from '../../src/views/thread-head.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ROOM, channel } from '../support/fixtures.ts'

usingFakeDom()

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
        presence: { humanOnline: true, agentOnline: false },
        people: null,
        mute: null,
      }),
    )
    expect(textOf(shown)).toContain('Billing')
    expect(textOf(shown)).toContain(strings.humanOnline)
    expect(
      textOf(
        host(
          renderThreadHead(context, {
            kind: 'people',
            title: 'Team',
            profile: null,
            presence: null,
            people: null,
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
        mute: null,
      }),
    )
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
        mute: null,
      }),
    )
    expect(textOf(archived)).toContain(strings.archived)
  })

  it('says how many people are in a group message, and lists them behind a button', () => {
    const { context } = testContext()
    const shown = host(
      renderThreadHead(context, {
        kind: 'people',
        title: 'Ana, Ben +1',
        profile: null,
        presence: null,
        people: {
          label: '4 people',
          title: strings.groupPeopleTitle,
          people: [
            { name: 'June', you: true },
            { name: 'Ana', you: false },
            { name: 'Ben', you: false },
            { name: 'Cy', you: false },
          ],
        },
        mute: null,
      }),
    )
    expect(queryByRole(shown, 'listitem')).toBeNull()
    getByRole(shown, 'button', { name: '4 people' }).click()
    expect(queryByRole(shown, 'list')).not.toBeNull()
    const listed = [...shown.querySelectorAll('li')].map((item) => textOf(item))
    expect(listed).toEqual([`June ${strings.youMark}`, 'Ana', 'Ben', 'Cy'])
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
        people: null,
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
