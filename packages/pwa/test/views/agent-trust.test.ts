import { lifetime } from '@homingbird/ui'
import { allByRole, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { agentTrustView } from '../../src/views/agent-trust.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { everything, me, report, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

describe('agentTrustView', () => {
  it('shows only the tab asked for, loads its figures, and focuses its heading', () => {
    const { context, called, page } = testContext()
    context.state.serverInfo.set(everything())
    const shown = mount(agentTrustView(context, lifetime(), me(), 'doing'))
    expect(called('refreshAgentReport')).toHaveLength(1)
    const tabs = getByRole(shown, 'navigation', { name: strings.trust.tabsLabel })
    expect(allByRole(tabs, 'link').map((link) => link.textContent)).toEqual([
      strings.trust.sections.connection,
      strings.trust.sections.teaching,
      strings.trust.sections.doing,
    ])
    expect(getByRole(tabs, 'link', { name: strings.trust.sections.doing }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(
      getByRole(tabs, 'link', { name: strings.trust.sections.teaching }).getAttribute('aria-current'),
    ).toBeNull()
    expect(allByRole(shown, 'heading', { name: strings.trust.sections.teaching })).toHaveLength(0)
    page.runFrames()
    expect(document.activeElement).toBe(document.getElementById('agent-doing'))
    expect(textOf(shown)).toContain(strings.loading)
    context.state.agentReport.set(report())
    expect(getByRole(shown, 'heading', { name: strings.trust.verdict.too_few })).toBeTruthy()
    expect(allByRole(shown, 'heading', { name: strings.measures.weekTitle })).toHaveLength(0)
    const week = { notesSent: 2, repliesReceived: 1, medianReplyMs: null }
    context.state.agentReport.set(report({ week: { days: 7, current: week, previous: week } }))
    expect(getByRole(shown, 'heading', { name: strings.measures.weekTitle })).toBeTruthy()
    expect(shown.querySelector('.trust-measured a[href="#/measured"]')?.textContent).toBe(
      strings.measures.pageLink,
    )
    getByRole(shown, 'radio', { name: strings.trust.lastDays({ days: 30 }) }).click()
    expect(getByRole(shown, 'table', { name: strings.trust.caption({ days: 30 }) })).toBeTruthy()
  })

  it('shows Connection without moving focus when no tab was asked for', () => {
    const { context, page } = testContext()
    context.state.serverInfo.set(everything())
    const shown = mount(agentTrustView(context, lifetime(), me(), null))
    expect(getByRole(shown, 'heading', { name: strings.trust.sections.connection })).toBeTruthy()
    expect(allByRole(shown, 'heading', { name: strings.trust.sections.doing })).toHaveLength(0)
    page.runFrames()
    expect(document.activeElement).toBe(document.body)
  })

  it('loads no report on Teaching', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(everything())
    agentTrustView(context, lifetime(), me(), 'teaching')
    expect(called('refreshAgentReport')).toHaveLength(0)
    expect(called('refreshPrinciples')).toHaveLength(1)
  })

  it('keeps Connection alone where the rest is off', () => {
    const { context } = testContext()
    context.state.serverInfo.set(serverInfo())
    const shown = agentTrustView(context, lifetime(), me(), 'teaching')
    expect(allByRole(shown, 'link').filter((link) => link.closest('.my-agent-tabs'))).toHaveLength(1)
    expect(allByRole(shown, 'heading', { name: strings.trust.sections.connection })).toHaveLength(1)
  })
})
