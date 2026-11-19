import { describe, expect, it } from 'vitest'
import { ANALYTICS_AGENT_PRESETS, ANALYTICS_PAGES } from '../src/analytics-values.ts'

describe('the values analytics may carry', () => {
  it('are names, never ids or paths', () => {
    for (const value of [...ANALYTICS_PAGES, ...ANALYTICS_AGENT_PRESETS])
      expect(value).toMatch(/^[a-z][a-z-]*$/)
    expect(ANALYTICS_AGENT_PRESETS).toContain('custom')
  })
})
