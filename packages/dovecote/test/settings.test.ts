import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { featureIsOn, isAllowedEmail, offeredFeatures, readSettings } from '../src/domain/settings.ts'
import { type Session, type TestServer, startTestServer, testConfig } from './harness.ts'

let server: TestServer
let ana: Session

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
})

afterEach(() => server?.close())

const settings = async () => (await ana.api('GET', '/admin/settings')).json

describe('the organization settings', () => {
  it('start from the operator’s variables until an administrator saves them', async () => {
    expect(await settings()).toMatchObject({ allowedDomains: ['example.com'], contactMode: 'open' })
    const saved = await ana.api('PUT', '/admin/settings', { ...(await settings()), contactMode: 'contacts' })
    expect(saved.json.contactMode).toBe('contacts')
    expect((await T.runPromise(readSettings, server.env)).contactMode).toBe('contacts')
  })

  it('keep the switches an administrator did not touch, and refuse a feature that does not exist', async () => {
    const current = await settings()
    await ana.api('PUT', '/admin/settings', { ...current, features: { teaching: false } })
    expect((await settings()).features).toMatchObject({ teaching: false, channels: true })
    expect(await T.runPromise(featureIsOn('teaching'), server.env)).toBe(false)
    const refused = await ana.api('PUT', '/admin/settings', { ...current, features: { telepathy: true } })
    expect([refused.status, refused.json.error.message]).toEqual([
      400,
      'There is no feature named telepathy.',
    ])
  })

  it('keep the answering flow apart, with the time it last changed, and refuse one that is not a list', async () => {
    const current = await settings()
    const flow = '## Before drafting\n1. Look the question up in the wiki.'
    await server.clock.advance(1_000)
    await ana.api('PUT', '/admin/settings', { ...current, answeringFlow: flow })
    expect((await ana.api('GET', '/answering-flow')).json).toEqual({ flow, updatedAt: server.clock.now() })
    expect(
      (await ana.api('PUT', '/admin/settings', { ...current, answeringFlow: 'Look it up.' })).status,
    ).toBe(400)
    await ana.api('PUT', '/admin/settings', { ...current, answeringFlow: '   ' })
    expect((await ana.api('GET', '/answering-flow')).json.flow).toBeNull()
  })

  it('offer analytics only when it has somewhere to go', () => {
    const switches = { allowedDomains: [], contactMode: 'open', features: { analytics: true } } as never
    expect(offeredFeatures(switches, testConfig()).analytics).toBe(false)
    expect(
      offeredFeatures(
        switches,
        testConfig({ HB_ANALYTICS: 'http', HB_ANALYTICS_URL: 'https://e.example.com' }),
      ).analytics,
    ).toBe(true)
  })

  it('allow an address by its domain, whatever its case', () => {
    const allowed = { allowedDomains: ['example.com'] } as never
    expect(isAllowedEmail(allowed, 'Ana@EXAMPLE.com')).toBe(true)
    expect(isAllowedEmail(allowed, 'ana@example.com.evil.test')).toBe(false)
  })
})
