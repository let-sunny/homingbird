import { lifetime } from '@homingbird/ui'
import { textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import type { Route } from '../../src/routes.ts'
import { strings } from '../../src/strings.ts'
import { stageFor } from '../../src/views/stage.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ROOM, everything, me, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const routes: ReadonlyArray<Route> = [
  { name: 'home' },
  { name: 'conversation', id: ROOM, draft: null },
  { name: 'people' },
  { name: 'group', id: 'grp_team00000000' },
  { name: 'channels' },
  { name: 'channel', slug: 'billing' },
  { name: 'debates' },
  { name: 'debate', id: 'debate_1' },
  { name: 'search', query: '' },
  { name: 'profile' },
  { name: 'agent', section: null },
  { name: 'measured' },
  { name: 'character', draft: null, from: null },
  { name: 'device', code: null },
  { name: 'consent', id: 'consent_1' },
  { name: 'admin', section: 'settings' },
]

const shows = (child: unknown): string => textOf(child)

describe('stageFor', () => {
  it('shows each page, and not found for a page off or out of reach', () => {
    const { context } = testContext()
    context.state.serverInfo.set(everything())
    const admin = me({}, { role: 'admin' })
    for (const route of routes)
      expect(shows(stageFor(context, lifetime(), admin, route))).not.toContain(strings.notFound)
    expect(shows(stageFor(context, lifetime(), me(), { name: 'admin', section: 'settings' }))).toContain(
      strings.notFound,
    )
    expect(shows(stageFor(context, lifetime(), me(), { name: 'unknown' }))).toContain(strings.notFound)
    expect(shows(stageFor(context, lifetime(), me(), { name: 'signed-out', reason: null }))).toContain(
      strings.notFound,
    )
    context.state.serverInfo.set(serverInfo())
    for (const name of ['debates', 'debate', 'character', 'group'] as const)
      expect(
        shows(stageFor(context, lifetime(), me(), routes.find((route) => route.name === name)!)),
      ).toContain(strings.notFound)
  })
})
