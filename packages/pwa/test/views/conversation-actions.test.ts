import { fire, getByRole, queryByRole } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import type { ConversationActions } from '../../src/models/conversation-actions.ts'
import { strings } from '../../src/strings.ts'
import { conversationActionItems, threadActionsMenu } from '../../src/views/conversation-actions.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ROOM } from '../support/fixtures.ts'

usingFakeDom()

const ACTIONS: ConversationActions = {
  hide: { conversationId: ROOM, hidden: false, label: 'Hide Team', hint: 'hint', done: 'You hid Team.' },
  newGroup: { label: strings.places.newGroup, hint: 'new hint', href: '#/new?to=a%2Cb' },
  leave: {
    conversationId: ROOM,
    label: strings.places.leave,
    title: 'Leave Team?',
    body: strings.places.leaveBody,
    done: 'You left Team.',
  },
}

const NONE: ConversationActions = { hide: null, leave: null, newGroup: null }

const mount = (...children: ReadonlyArray<Node | false | null | undefined>): HTMLElement => {
  const host = document.createElement('div')
  for (const child of children) if (child) host.append(child)
  document.body.append(host)
  return host
}

describe('the conversation actions', () => {
  it('hides, links to a new group with the same people, and leaves only after the person confirms', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    const host = mount(...(conversationActionItems(context, ACTIONS).filter(Boolean) as Node[]))
    getByRole(host, 'button', { name: 'Hide Team' }).click()
    expect(called('setHidden').map((call) => call.args)).toEqual([[ROOM, true, 'You hid Team.']])
    const link = host.querySelector<HTMLAnchorElement>('a.new-group')!
    expect(link.textContent).toBe(strings.places.newGroup)
    expect(link.getAttribute('href')).toBe('#/new?to=a%2Cb')
    expect(link.getAttribute('role')).toBe('menuitem')
    getByRole(host, 'button', { name: strings.places.leave }).click()
    expect(called('leaveGroup')).toEqual([])
    const dialog = document.getElementById('dialog') as HTMLDialogElement
    expect(dialog.textContent).toContain(strings.places.leaveBody)
    fire.submit(dialog.querySelector('form')!)
    expect(called('leaveGroup').map((call) => call.args)).toEqual([[ROOM, 'You left Team.']])
  })

  it('asks to show a hidden conversation again', () => {
    const { context, called } = testContext()
    const hide = { ...ACTIONS.hide!, hidden: true, label: 'Show Team', done: null }
    const host = mount(...(conversationActionItems(context, { ...NONE, hide }).filter(Boolean) as Node[]))
    getByRole(host, 'button', { name: 'Show Team' }).click()
    expect(called('setHidden').map((call) => call.args)).toEqual([[ROOM, false, null]])
    expect(queryByRole(host, 'button', { name: strings.places.leave })).toBeNull()
  })

  it('puts them behind a ⋯ in the head of the conversation, and draws no ⋯ when there is nothing to offer', () => {
    const { context } = testContext()
    const menu = threadActionsMenu(context, 'More for Team', ACTIONS)!
    const host = mount(menu.trigger, menu.menu)
    expect(getByRole(host, 'button', { name: 'More for Team' }).textContent).toBe('⋯')
    expect(menu.menu.querySelectorAll('[role="menuitem"]')).toHaveLength(3)
    expect(threadActionsMenu(context, 'More for Ben', NONE)).toBeNull()
  })
})
