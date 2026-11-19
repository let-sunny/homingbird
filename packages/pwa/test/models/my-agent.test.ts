import { describe, expect, it } from 'vitest'
import { myAgentModel } from '../../src/models/my-agent.ts'
import { strings } from '../../src/strings.ts'
import { everything, serverInfo } from '../support/fixtures.ts'

describe('myAgentModel', () => {
  it('shows every section whose feature is on, marks the one asked for, and focuses it', () => {
    const model = myAgentModel(everything(), 'doing')
    expect(model.sections.map((section) => section.section)).toEqual([
      'connection',
      'teaching',
      'doing',
      'routes',
    ])
    expect(model.navigation.find((link) => link.current)?.href).toBe('#/agent/doing')
    expect(model.loadsFigures).toBe(true)
    expect(model.focus).toBe('doing')
    expect(model.title).toBe(strings.trust.pageTitle)
  })

  it('keeps Connection when everything else is off, and the route map only with teaching', () => {
    expect(myAgentModel(serverInfo(), null).sections.map((section) => section.section)).toEqual([
      'connection',
    ])
    expect(
      myAgentModel(serverInfo({ routeMap: true }), null).sections.map((section) => section.section),
    ).toEqual(['connection'])
    expect(myAgentModel(serverInfo({ routeMap: true }), null).loadsFigures).toBe(false)
  })
})
