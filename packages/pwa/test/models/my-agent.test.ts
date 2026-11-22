import { describe, expect, it } from 'vitest'
import { myAgentModel } from '../../src/models/my-agent.ts'
import { AGENT_SECTIONS } from '../../src/routes.ts'
import { strings } from '../../src/strings.ts'
import { everything, serverInfo } from '../support/fixtures.ts'

describe('myAgentModel', () => {
  it('offers a tab for every section whose feature is on and shows only the one asked for', () => {
    const model = myAgentModel(everything(), 'doing')
    expect(model.tabs.map((tab) => tab.href)).toEqual([
      '#/agent/connection',
      '#/agent/teaching',
      '#/agent/doing',
    ])
    expect(model.tabs.filter((tab) => tab.current).map((tab) => tab.section)).toEqual(['doing'])
    expect(model.shown).toEqual({
      section: 'doing',
      title: strings.trust.sections.doing,
      hint: strings.trust.sectionHints.doing,
    })
    expect(model.loadsReport).toBe(true)
    expect(model.focusesHeading).toBe(true)
    expect(model.title).toBe(strings.trust.pageTitle)
  })

  it('shows the first tab without moving focus when no section was asked for', () => {
    const model = myAgentModel(everything(), null)
    expect(model.shown.section).toBe('connection')
    expect(model.tabs.find((tab) => tab.current)?.section).toBe('connection')
    expect(model.focusesHeading).toBe(false)
  })

  it('loads the report only on How it is doing and Connection, and only with figures on', () => {
    const all = serverInfo({ ...everything().features, draftPreviews: true })
    for (const section of AGENT_SECTIONS)
      expect(myAgentModel(all, section).loadsReport).toBe(section === 'doing' || section === 'connection')
    expect(myAgentModel(serverInfo({ teaching: true }), 'connection').loadsReport).toBe(false)
  })

  it('keeps Connection when everything else is off, and each other tab only with its feature', () => {
    expect(myAgentModel(serverInfo(), null).tabs.map((tab) => tab.section)).toEqual(['connection'])
    expect(myAgentModel(serverInfo({ teaching: true }), null).tabs.map((tab) => tab.section)).toEqual([
      'connection',
      'teaching',
    ])
    expect(myAgentModel(serverInfo({ agentFigures: true }), null).tabs.map((tab) => tab.section)).toEqual([
      'connection',
      'doing',
    ])
  })

  it('offers Early previews only while the organization has draft previews on', () => {
    expect(myAgentModel(serverInfo({ draftPreviews: true }), 'previews').shown).toEqual({
      section: 'previews',
      title: strings.trust.sections.previews,
      hint: strings.trust.sectionHints.previews,
    })
    expect(myAgentModel(serverInfo(), 'previews').shown.section).toBe('connection')
  })

  it('falls back to Connection when the section asked for is switched off', () => {
    const model = myAgentModel(serverInfo({ teaching: true }), 'doing')
    expect(model.shown.section).toBe('connection')
    expect(model.loadsReport).toBe(false)
    expect(model.tabs.find((tab) => tab.current)?.section).toBe('connection')
  })
})
