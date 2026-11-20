import { lifetime } from '@homingbird/ui'
import { allByRole, getByRole } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { adminView } from '../../src/views/admin.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { everything, me } from '../support/fixtures.ts'

usingFakeDom()

describe('adminView', () => {
  it('shows the tab asked for and loads what it needs', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(everything())
    const admin = me({}, { role: 'admin' })
    for (const [section, action] of [
      ['settings', 'loadSettings'],
      ['members', 'listMembers'],
      ['groups', 'loadGroups'],
      ['channels', 'loadKnownChannels'],
      ['insights', 'loadInsights'],
    ] as const) {
      const before = called(action).length
      const shown = adminView(context, lifetime(), admin, section)
      expect(called(action).length).toBeGreaterThan(before)
      expect(allByRole(getByRole(shown, 'navigation'), 'link')).toHaveLength(5)
    }
    const shown = adminView(context, lifetime(), admin, 'members')
    expect(getByRole(shown, 'link', { name: strings.adminMembers }).getAttribute('aria-current')).toBe('page')
  })
})
