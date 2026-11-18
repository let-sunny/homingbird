import { Task as T } from '@homingbird/kernel'
import { type RouteName, contract } from '@homingbird/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { housekeepingPass, presenceBroadcast } from '../src/runtime.ts'
import {
  type Session,
  type TestServer,
  connectAgent,
  everyStoredValue,
  startTestServer,
  storedRows,
} from './harness.ts'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const TOKEN_SHAPED = /hb[har]_[A-Za-z0-9_-]{20,}/

let server: TestServer
afterEach(() => server.close())

const scenario = async (overrides: Record<string, string> = {}, fetch?: typeof globalThis.fetch) => {
  server = await startTestServer(overrides, fetch ? { fetch: fetch as never } : {})
  const ana = await server.signIn('ana@example.com', 'Ana')
  const ben = await server.signIn('ben@example.com', 'Ben')
  const anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
  const draft = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'audited question' }))
    .json
  await anaAgent.api('PATCH', `/drafts/${draft.id}`, { body: 'audited question v2' })
  const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, { body: 'audited question final' })).json
  await ben.api('POST', `/notes/${sent.id}/read`)
  const reply = (await ben.api('POST', '/drafts', { inReplyTo: sent.id, body: 'audited reply' })).json
  await ben.api('POST', `/drafts/${reply.id}/discard`)
  await anaAgent.api('POST', `/drafts/${draft.id}/send`, {})
  await ana.api('PATCH', '/me', { profile: 'Billing' })
  await ana.api('PUT', `/blocks/${ben.me.member.id}`)
  await server.request('POST', '/auth/logout', { cookie: ben.cookie })
  return { ana, ben, anaAgent, sent, reply }
}

const entries = async (session: Session, query = '') =>
  (await session.api('GET', `/admin/audit${query}`)).json

describe('the audit log', () => {
  it('records every state-changing action with who did it and the note content', async () => {
    const { ana, ben, sent, reply } = await scenario()
    const log = (await entries(ana, '?limit=200')).entries
    const actions = log.map((entry: any) => entry.action)
    for (const expected of [
      'session.signed_in',
      'device.approved',
      'credential.issued',
      'drafts.create',
      'drafts.update',
      'drafts.send',
      'notes.read',
      'drafts.discard',
      'denied:drafts.send',
      'me.update',
      'blocks.add',
      'session.signed_out',
    ])
      expect(actions).toContain(expected)

    const sending = log.find((entry: any) => entry.action === 'drafts.send')
    expect(sending).toMatchObject({
      actorId: ana.me.member.id,
      credentialKind: 'human',
      target: sent.id,
      detail: {
        request: { body: 'audited question final' },
        note: { status: 'sent', body: 'audited question final' },
      },
    })
    const discarding = log.find((entry: any) => entry.action === 'drafts.discard')
    expect(discarding).toMatchObject({
      actorId: ben.me.member.id,
      target: reply.id,
      detail: { note: { body: 'audited reply' } },
    })
    const denied = log.find((entry: any) => entry.action === 'denied:drafts.send')
    expect(denied).toMatchObject({ actorId: ana.me.member.id, credentialKind: 'agent' })
  })

  it('does not record reads', async () => {
    const { ana } = await scenario()
    const before = (await storedRows(server, 'audit_log')).length
    for (const name of Object.keys(contract) as RouteName[])
      if (contract[name].method === 'GET' && !contract[name].path.includes(':'))
        await ana.api('GET', contract[name].path)
    expect((await storedRows(server, 'audit_log')).length).toBe(before)
  })

  it('never contains a credential, anywhere in the database or the server log', async () => {
    const { ana, ben, anaAgent } = await scenario({ HB_AUDIT_STDOUT: '1' })
    const stored = await everyStoredValue(server)
    const logged = server.logged.join('\n')
    for (const token of [ana.token, ben.token, anaAgent.token]) {
      expect(stored.includes(token)).toBe(false)
      expect(logged.includes(token)).toBe(false)
    }
    expect(stored).not.toMatch(TOKEN_SHAPED)
    expect(logged).not.toMatch(TOKEN_SHAPED)
  })

  it('filters by actor and action and pages backwards', async () => {
    const { ana, ben } = await scenario()
    const byBen = (await entries(ana, `?actorId=${ben.me.member.id}`)).entries
    expect(byBen.length).toBeGreaterThan(0)
    expect(new Set(byBen.map((entry: any) => entry.actorId))).toEqual(new Set([ben.me.member.id]))
    const sends = (await entries(ana, '?action=drafts.send')).entries
    expect(sends.map((entry: any) => entry.action)).toEqual(['drafts.send'])
    const firstPage = await entries(ana, '?limit=3')
    expect(firstPage.entries).toHaveLength(3)
    expect(firstPage.hasMore).toBe(true)
    const secondPage = await entries(ana, `?limit=3&before=${firstPage.entries[2].id}`)
    expect(secondPage.entries[0].id).toBeLessThan(firstPage.entries[2].id)
  })

  it('rolls the audit entry back together with a failed action', async () => {
    const { ana } = await scenario()
    const before = (await storedRows(server, 'audit_log')).length
    expect((await ana.api('POST', '/drafts/note_doesnotexist00/send', {})).status).toBe(404)
    expect((await storedRows(server, 'audit_log')).length).toBe(before)
  })
})

describe('audit forwarding', () => {
  it('prints one JSON line per entry on stdout when enabled, and nothing otherwise', async () => {
    await scenario({ HB_AUDIT_STDOUT: '1' })
    const lines = server.logged.filter((line) => line.startsWith('{')).map((line) => JSON.parse(line))
    expect(lines.length).toBe((await storedRows(server, 'audit_log')).length)
    expect(lines.find((line) => line.action === 'drafts.send')).toMatchObject({
      type: 'audit',
      detail: { note: { body: 'audited question final' } },
    })
    await server.close()
    await scenario()
    expect(server.logged.filter((line) => line.startsWith('{'))).toEqual([])
  })

  it('posts batches to the webhook, retrying with backoff, and gives up loudly', async () => {
    const posts: Array<{ url: string; count: number }> = []
    let failures = 2
    const fetch = (async (url: string, init?: RequestInit) => {
      posts.push({ url, count: JSON.parse(String(init?.body)).entries.length })
      return new Response('', { status: failures-- > 0 ? 500 : 200 })
    }) as never
    await scenario({ HB_AUDIT_WEBHOOK_URL: 'https://siem.example.com/in' }, fetch)
    const total = (await storedRows(server, 'audit_log')).length
    const running = T.runFork(server.background, server.env)
    await server.clock.flush()
    expect(posts).toHaveLength(1)
    await server.clock.advance(1_000)
    expect(posts).toHaveLength(2)
    await server.clock.advance(2_000)
    await server.settled()
    expect(posts.length).toBeGreaterThanOrEqual(3)
    expect(posts.every((post) => post.url === 'https://siem.example.com/in' && post.count <= 100)).toBe(true)
    expect(posts.slice(2).reduce((sum, post) => sum + post.count, 0)).toBe(total)

    failures = Number.POSITIVE_INFINITY
    const admin = await server.signIn('ana@example.com')
    await admin.api('PATCH', '/me', { profile: 'again' })
    await server.clock.advance(10 * 60_000)
    await server.settled()
    expect(server.logged.some((line) => /audit webhook: dropped \d+ entries \(status 500\)/.test(line))).toBe(
      true,
    )
    await running.interrupt()
  })
})

describe('housekeeping', () => {
  it('trims old events, expired sign-in attempts and audit entries past retention', async () => {
    const { ana } = await scenario()
    await ana.api('PUT', '/admin/settings', {
      allowedDomains: ['example.com'],
      contactMode: 'open',
      auditRetentionDays: 30,
    })
    await server.request('GET', '/auth/login')
    await T.runPromise(housekeepingPass, server.env)
    expect((await storedRows(server, 'events')).length).toBeGreaterThan(0)
    expect((await storedRows(server, 'audit_log')).length).toBeGreaterThan(0)
    await server.clock.advance(8 * DAY + HOUR)
    await T.runPromise(housekeepingPass, server.env)
    expect(await storedRows(server, 'events')).toEqual([])
    expect(await storedRows(server, 'auth_requests')).toEqual([])
    expect((await storedRows(server, 'audit_log')).length).toBeGreaterThan(0)
    await server.clock.advance(23 * DAY + HOUR)
    await T.runPromise(housekeepingPass, server.env)
    expect(await storedRows(server, 'audit_log')).toEqual([])
  })

  it('keeps audit entries forever by default', async () => {
    await scenario()
    await server.clock.advance(400 * DAY)
    await T.runPromise(housekeepingPass, server.env)
    expect((await storedRows(server, 'audit_log')).length).toBeGreaterThan(0)
  })

  it('broadcasts presence once a second', async () => {
    const { ana, anaAgent } = await scenario()
    const hangUp = new AbortController()
    const stream = await server.request('GET', '/api/v1/events/stream', {
      cookie: ana.cookie,
      signal: hangUp.signal,
    })
    const iterator = (stream.raw.body as AsyncIterable<string>)[Symbol.asyncIterator]()
    await server.request('GET', '/api/v1/events/stream', { token: anaAgent.token, signal: hangUp.signal })
    const next = iterator.next()
    const running = T.runFork(presenceBroadcast, server.env)
    await server.clock.flush()
    const frame = (await next).value as string
    expect(frame).toMatch(/^event: presence\n/)
    expect(JSON.parse(frame.split('data: ')[1]!).body.members).toEqual([
      { memberId: ana.me.member.id, humanOnline: true, agentOnline: true },
    ])
    hangUp.abort()
    await running.interrupt()
  })
})
