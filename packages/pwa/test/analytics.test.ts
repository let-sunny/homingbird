import { describe, expect, it } from 'vitest'
import { type AnalyticsStorage, anonymousId, eventToSend } from '../src/analytics.ts'

const memoryStorage = (
  ids: string[] = ['3f2a9c1e-0000-4000-8000-000000000001'],
): AnalyticsStorage & {
  readonly kept: Map<string, string>
} => {
  const kept = new Map<string, string>()
  return {
    kept,
    local: (key) => kept.get(key) ?? null,
    setLocal: (key, value) => void kept.set(key, value),
    session: () => null,
    setSession: () => {},
    newId: () => ids.shift() ?? 'fallback-id-0001',
  }
}

const INFO = {
  name: 'dovecote',
  version: '0.1.4',
  contactMode: 'open',
  signInWith: 'Google',
  features: {},
} as const

describe('product analytics in the web client', () => {
  it('sends nothing while the server does not offer analytics', () => {
    const storage = memoryStorage()
    expect(eventToSend(INFO, 'page_viewed', { page: 'home' }, storage, 1)).toBeNull()
    expect(eventToSend(null, 'page_viewed', { page: 'home' }, storage, 1)).toBeNull()
    expect(storage.kept.size).toBe(0)
  })

  it('sends a catalogue event under one anonymous id kept in the browser', () => {
    const storage = memoryStorage()
    const info = { ...INFO, features: { analytics: true } }
    const first = eventToSend(info, 'page_viewed', { page: 'home' }, storage, 5)
    const second = eventToSend(info, 'debate_opened', { visibility: 'open' }, storage, 6)
    expect(first).toEqual({
      event: 'page_viewed',
      properties: { page: 'home' },
      anonymousId: '3f2a9c1e-0000-4000-8000-000000000001',
      timestamp: 5,
    })
    expect(second?.anonymousId).toBe(first?.anonymousId)
  })

  it('replaces a kept id that is not one it would have made', () => {
    const storage = memoryStorage(['fresh-id-000001'])
    storage.setLocal('homingbird.anonymousId', 'ana@example.com')
    expect(anonymousId(storage)).toBe('fresh-id-000001')
  })
})

describe('counting from the page', () => {
  it('counts an event while the server offers analytics, and drops a failure', async () => {
    const { testApp, settle } = await import('./support/app.ts')
    const { track, trackSignIn } = await import('../src/analytics.ts')
    const { app, run, sent, page } = testApp({
      'analytics.track': () => ({ refusal: { _tag: 'Unavailable', message: 'down' } }),
    })
    await run(track('page_viewed', { page: 'home' }))
    await settle()
    expect(sent).toEqual([])
    app.state.serverInfo.set({ ...INFO, features: { analytics: true }, protocolVersion: 1 })
    await run(track('page_viewed', { page: 'home' }))
    await settle()
    expect(sent.map((one) => one.route)).toEqual(['analytics.track'])
    expect(page.local.get('homingbird.anonymousId')).toBe('page-id')
    await run(trackSignIn)
    await run(trackSignIn)
    await settle()
    expect(sent).toHaveLength(2)
  })
})
