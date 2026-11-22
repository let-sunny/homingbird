import { lifetime } from '@homingbird/ui'
import { getByRole, getByText, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { homeView, startingPoints } from '../../src/views/home.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ROOM, conversation, credential, note } from '../support/fixtures.ts'

usingFakeDom()

describe('homeView', () => {
  it('waits for the list, then offers where to start when there is nothing yet', () => {
    const { context, tour } = testContext()
    const shown = homeView(context, lifetime())
    expect(shown.textContent).toBe(strings.loading)
    context.state.conversationsLoaded.set(true)
    expect(getByRole(shown, 'heading', { name: strings.start.firstTitle })).toBeTruthy()
    expect(textOf(shown.querySelector('.start-step pre')!)).toContain('/homingbird http://localhost')
    context.state.agentCredentials.set([credential('cred_desk')])
    expect(shown.querySelector('.start-step pre')).toBeNull()
    expect(textOf(shown.querySelector('.start-step.is-done')!)).toContain(strings.start.done)
    expect(getByRole(shown, 'link', { name: strings.start.findPerson }).className).toBe('button primary')
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
  it('links to a person, a channel and connecting another agent, and follows the agent connecting', () => {
    const { context } = testContext()
    const shown = startingPoints(context, lifetime())
    expect(getByRole(shown, 'link', { name: strings.start.findPerson }).getAttribute('href')).toBe('#/people')
    expect(getByRole(shown, 'link', { name: strings.start.otherAgents }).getAttribute('href')).toBe(
      '#/agent/connection',
    )
    context.state.agentCredentials.set([credential('cred_desk')])
    expect(queryByRole(shown, 'link', { name: strings.start.otherAgents })).toBeNull()
  })
})
