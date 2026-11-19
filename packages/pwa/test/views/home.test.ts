import { lifetime } from '@homingbird/ui'
import { getByRole, getByText } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { homeView, startingPoints } from '../../src/views/home.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ROOM, conversation, note } from '../support/fixtures.ts'

usingFakeDom()

describe('homeView', () => {
  it('waits for the list, then offers where to start when there is nothing yet', () => {
    const { context, tour } = testContext()
    const shown = homeView(context, lifetime())
    expect(shown.textContent).toBe(strings.loading)
    context.state.conversationsLoaded.set(true)
    expect(getByRole(shown, 'heading', { name: strings.start.title })).toBeTruthy()
    getByRole(shown, 'button', { name: strings.start.tour }).click()
    expect(tour.started).toBe(1)
  })

  it('opens the most recent conversation by itself when it sits beside the list', () => {
    const { context, page } = testContext()
    const sidebar = document.createElement('aside')
    sidebar.className = 'sidebar'
    mount(sidebar)
    const shown = mount(homeView(context, lifetime()))
    context.state.conversations.set([conversation({ lastNote: note('n1') })])
    context.state.conversationsLoaded.set(true)
    expect(getByText(shown, strings.pickConversation)).toBeTruthy()
    page.runFrames()
    expect(page.visited).toEqual([`replace #/c/${ROOM}`])
    expect(context.state.openedForThePerson.get()).toBe(ROOM)
  })

  it('stays on home on a narrow screen', () => {
    const { context, page } = testContext()
    mount(homeView(context, lifetime()))
    context.state.conversations.set([conversation({ lastNote: note('n1') })])
    context.state.conversationsLoaded.set(true)
    page.runFrames()
    expect(page.visited).toEqual([])
  })
})

describe('startingPoints', () => {
  it('links to a channel, a person and connecting an agent', () => {
    const { context } = testContext()
    const shown = startingPoints(context)
    expect(getByRole(shown, 'link', { name: strings.start.findPerson }).getAttribute('href')).toBe('#/people')
  })
})
