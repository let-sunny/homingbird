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
  it('shows every section whose feature is on, loads the figures, and focuses the section asked for', () => {
    const { context, called, page } = testContext()
    context.state.serverInfo.set(everything())
    const shown = mount(agentTrustView(context, lifetime(), me(), 'doing'))
    expect(called('refreshAgentReport')).toHaveLength(1)
    expect(allByRole(getByRole(shown, 'navigation'), 'link').map((link) => link.textContent)).toEqual([
      strings.trust.sections.connection,
      strings.trust.sections.teaching,
      strings.trust.sections.doing,
      strings.trust.sections.routes,
    ])
    expect(
      getByRole(shown, 'link', { name: strings.trust.sections.doing }).getAttribute('aria-current'),
    ).toBe('location')
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

  it('keeps Connection alone where the rest is off, and moves nowhere without a section', () => {
    const { context, called, page } = testContext()
    context.state.serverInfo.set(serverInfo())
    const shown = agentTrustView(context, lifetime(), me(), null)
    expect(allByRole(shown, 'heading', { name: strings.trust.sections.connection })).toHaveLength(1)
    expect(called('refreshAgentReport')).toHaveLength(0)
    page.runFrames()
    expect(document.activeElement).toBe(document.body)
  })
})
