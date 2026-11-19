import { type TestBody, expect, test } from 'claude-code/testing'

import { paneTextIn } from '../hooks/pane-text'
import { freshStartReasonOf } from '../hooks/session-health'
import { OVERVIEW, PANE, START, type World, engineBeneath, openDesk } from './world'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const isDueForFreshStart = async ($: Engine, on: On, world: Partial<World>): Promise<boolean> => {
  const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true, ...world })
  await $.session.start(START)
  await openDesk($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const line = (await ui.find({ type: 'Text', text: /fresh one/ }))?.text ?? null
  await ui.unmount()
  seen.release()
  if (line !== null) expect(line).toBe(paneTextIn('en').freshSession('context-compact-unknown'))
  return line !== null
}

const sessionToldOnDraft = async ($: Engine, on: On, world: Partial<World>): Promise<string | null> => {
  const seen = engineBeneath(on, { overview: OVERVIEW, ...world })
  await $.session.start(START)
  await seen.clock.settle()
  await $.tool.run({ tool: 'mcp__homingbird__draft_note', to: 'june@example.com', text: 'Done?' } as never)
  return seen.sessions.at(-1) ?? null
}

test('a young session with room left is not due for a fresh start', async ($, on) => {
  expect(await isDueForFreshStart($, on, { sessionUsage: { startedAt: -30 * 60_000, percent: 40 } })).toBe(
    false,
  )
})

test('a session at 80% of its context is due for a fresh start', async ($, on) => {
  expect(await isDueForFreshStart($, on, { sessionUsage: { startedAt: 0, percent: 80 } })).toBe(true)
})

test('a host that tells nothing about its session is never due', async ($, on) => {
  expect(await isDueForFreshStart($, on, {})).toBe(false)
})

test('a draft from a host that tells nothing carries no session', async ($, on) => {
  expect(await sessionToldOnDraft($, on, {})).toBeNull()
})

test('a context reading above 100 is clamped, keeping the age', async ($, on) => {
  expect(
    await sessionToldOnDraft($, on, { sessionUsage: { startedAt: -10 * 60_000, percent: 140 } }),
  ).toMatch(/^1\d,100$/)
})

test('a fresh start is due by age whatever the context, and by context only without auto-compact', () => {
  expect(freshStartReasonOf(null)).toBeNull()
  expect(freshStartReasonOf({ ageMinutes: 480, contextPercent: null, autoCompact: true })).toBe('age')
  expect(freshStartReasonOf({ ageMinutes: 479, contextPercent: null, autoCompact: null })).toBeNull()
  expect(freshStartReasonOf({ ageMinutes: 10, contextPercent: 79, autoCompact: false })).toBeNull()
  expect(freshStartReasonOf({ ageMinutes: 10, contextPercent: 80, autoCompact: false })).toBe('context')
  expect(freshStartReasonOf({ ageMinutes: 10, contextPercent: 95, autoCompact: true })).toBeNull()
  expect(freshStartReasonOf({ ageMinutes: 10, contextPercent: 80, autoCompact: null })).toBe(
    'context-compact-unknown',
  )
})

test('a session at 80% of its context that compacts itself is not due', async ($, on) => {
  expect(
    await isDueForFreshStart($, on, { sessionUsage: { startedAt: 0, percent: 90 }, autoCompact: true }),
  ).toBe(false)
})
