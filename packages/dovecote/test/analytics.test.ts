import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { type TestServer, connectAgent, startTestServer, storedRows } from './harness.ts'

let server: TestServer
afterEach(() => server.close())

const POSTHOG = { HB_ANALYTICS: 'posthog', HB_ANALYTICS_KEY: 'phc_projectkey' }

const event = (name: string, properties: Record<string, unknown>) => ({
  event: name,
  properties,
  anonymousId: 'anon-12345678',
  timestamp: 1_700_000_000_000,
})

const switchOn = async (ana: Awaited<ReturnType<TestServer['signIn']>>) => {
  const settings = (await ana.api('GET', '/admin/settings')).json
  await ana.api('PUT', '/admin/settings', { ...settings, features: { analytics: true } })
}

const capturing = () => {
  const posts: Array<{ url: string; body: any }> = []
  let status = 200
  return {
    posts,
    failWith: (next: number) => {
      status = next
    },
    fetch: (async (url: string, init?: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init?.body)) })
      return new Response('', { status })
    }) as never,
  }
}

describe('product analytics', () => {
  it('are off by default, and stay off while no destination is set, even when switched on', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com')
    expect((await server.request('GET', '/api/v1/info')).json.features.analytics).toBe(false)
    await switchOn(ana)
    expect((await server.request('GET', '/api/v1/info')).json.features.analytics).toBe(false)
    const refused = await ana.api('POST', '/analytics/events', {
      events: [event('page_viewed', { page: 'home' })],
    })
    expect(refused.status).toBe(404)
  })

  it('are offered once switched on with a destination, and forwarded to PostHog without the member', async () => {
    const destination = capturing()
    server = await startTestServer(POSTHOG, { fetch: destination.fetch })
    const ana = await server.signIn('ana@example.com')
    expect(
      (await ana.api('POST', '/analytics/events', { events: [event('page_viewed', { page: 'home' })] }))
        .status,
    ).toBe(404)
    await switchOn(ana)
    expect((await server.request('GET', '/api/v1/info')).json.features.analytics).toBe(true)
    const agent = await connectAgent(server, ana)
    const sent = await agent.api('POST', '/analytics/events', {
      events: [event('desk_started', { agentPreset: 'claude' }), event('page_viewed', { page: 'home' })],
    })
    expect(sent.status).toBe(200)
    expect(destination.posts).toEqual([])
    await forwarded()
    const distinctId = destination.posts[0]?.body.batch[0].distinct_id
    expect(distinctId).toMatch(/^[0-9a-f]{32}$/)
    expect(destination.posts).toEqual([
      {
        url: 'https://us.i.posthog.com/batch/',
        body: {
          api_key: 'phc_projectkey',
          batch: [
            {
              event: 'desk_started',
              distinct_id: distinctId,
              properties: { agentPreset: 'claude', $process_person_profile: false },
              timestamp: '2023-11-14T22:13:20.000Z',
            },
            {
              event: 'page_viewed',
              distinct_id: distinctId,
              properties: { page: 'home', $process_person_profile: false },
              timestamp: '2023-11-14T22:13:20.000Z',
            },
          ],
        },
      },
    ])
    expect(JSON.stringify(destination.posts)).not.toMatch(/mem_|ana@example\.com|cred_|anon-12345678/)
    expect(await storedRows(server, 'audit_events')).not.toContainEqual(
      expect.objectContaining({ event: expect.stringContaining('analytics') }),
    )
  })

  it('refuses the whole batch when one event or property is not in the catalogue, forwarding nothing', async () => {
    const destination = capturing()
    server = await startTestServer(POSTHOG, { fetch: destination.fetch })
    const ana = await server.signIn('ana@example.com')
    await switchOn(ana)
    for (const events of [
      [event('page_viewed', { page: 'home' }), event('note_read', {})],
      [event('page_viewed', { page: 'home', email: 'ana@example.com' })],
      [event('principle_saved', { kind: 'secret rule text' })],
      [event('page_viewed', { page: 'conversation/conv_secret' })],
      [event('desk_started', { agentPreset: '/home/ana/bin/agent' })],
    ]) {
      const refused = await ana.api('POST', '/analytics/events', { events })
      expect(refused.status).toBe(400)
    }
    await forwarded()
    expect(destination.posts).toEqual([])
  })

  it('answers the client even when the destination fails, and says so in the log without the key', async () => {
    const destination = capturing()
    destination.failWith(503)
    server = await startTestServer(POSTHOG, { fetch: destination.fetch })
    const ana = await server.signIn('ana@example.com')
    await switchOn(ana)
    expect(
      (await ana.api('POST', '/analytics/events', { events: [event('page_viewed', { page: 'home' })] }))
        .status,
    ).toBe(200)
    await forwarded()
    const failed = server.logged
      .map((line) => JSON.parse(line))
      .find((line) => line.eventName === 'analytics.forward_failed')
    expect(failed.attributes).toMatchObject({ destination: 'posthog', status: 503 })
    expect(server.logged.join('\n')).not.toContain('phc_projectkey')
  })

  it('re-keys a member id sent as the anonymous id, so it never leaves as sent', async () => {
    const destination = capturing()
    server = await startTestServer(POSTHOG, { fetch: destination.fetch })
    const ana = await server.signIn('ana@example.com')
    await switchOn(ana)
    const smuggled = { ...event('page_viewed', { page: 'home' }), anonymousId: ana.me.member.id }
    expect((await ana.api('POST', '/analytics/events', { events: [smuggled] })).status).toBe(200)
    await forwarded()
    expect(JSON.stringify(destination.posts)).not.toContain(ana.me.member.id)
  })

  it('refuses more than 60 events a minute from one credential', async () => {
    server = await startTestServer(POSTHOG, { fetch: capturing().fetch })
    const ana = await server.signIn('ana@example.com')
    await switchOn(ana)
    const batch = { events: Array.from({ length: 20 }, () => event('page_viewed', { page: 'home' })) }
    for (let round = 0; round < 3; round++)
      expect((await ana.api('POST', '/analytics/events', batch)).status).toBe(200)
    expect((await ana.api('POST', '/analytics/events', batch)).status).toBe(429)
    await server.clock.advance(60_000)
    expect((await ana.api('POST', '/analytics/events', batch)).status).toBe(200)
  })
})

const forwarded = async () => {
  const running = T.runFork(server.env.analytics.run, server.env)
  await server.settled()
  await running.interrupt()
}
