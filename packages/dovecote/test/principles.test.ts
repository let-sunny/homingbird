import { Task as T } from '@homingbird/kernel'
import { principlesInstructions } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  connectAgent,
  startTestServer,
  storedRows,
} from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let anaAgent: Agent

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
})

afterEach(() => server.close())

const RELEASES = {
  topic: 'Release dates',
  rule: 'check RELEASES.md and give weekday and time zone',
  place: null,
}

const save = async (body: object = RELEASES) => ana.api('POST', '/principles', body)
const applications = async () => storedRows(server, 'principle_applications')
const switchTeaching = async (teaching: boolean) => {
  const settings = (await ana.api('GET', '/admin/settings')).json
  return ana.api('PUT', '/admin/settings', { ...settings, features: { ...settings.features, teaching } })
}
const mine = async () => (await ana.api('GET', '/principles')).json

const agentDraft = async (body: string, basis?: string) =>
  (
    await anaAgent.api('POST', '/drafts', {
      to: [ben.me.member.id],
      body,
      ...(basis !== undefined && { basis }),
    })
  ).json

describe('saving principles', () => {
  it('saves, lists, edits, turns off and deletes a principle', async () => {
    const saved = (await save({ ...RELEASES, source: 'https://wiki.example/releases' })).json
    expect(saved).toMatchObject({
      ...RELEASES,
      source: 'https://wiki.example/releases',
      enabled: true,
      origin: 'manual',
    })
    expect((await mine()).principles.map((each: { id: string }) => each.id)).toEqual([saved.id])
    const edited = (
      await ana.api('PATCH', `/principles/${saved.id}`, { rule: 'check RELEASES.md', enabled: false })
    ).json
    expect(edited).toMatchObject({ rule: 'check RELEASES.md', enabled: false })
    expect((await ana.api('DELETE', `/principles/${saved.id}`)).json.topic).toBe('Release dates')
    expect((await mine()).principles).toEqual([])
    expect((await ana.api('DELETE', `/principles/${saved.id}`)).status).toBe(404)
  })

  it('checks length, title, source and the limit again on the server', async () => {
    expect((await save({ ...RELEASES, rule: 'x'.repeat(290) })).status).toBe(400)
    expect((await save({ ...RELEASES, source: 'javascript:alert(1)' })).status).toBe(400)
    expect((await save({ ...RELEASES, topic: 'Two; titles' })).status).toBe(400)
    await save()
    expect((await save({ ...RELEASES, topic: 'release DATES' })).status).toBe(409)
    for (let index = 1; index < 50; index++) await save({ ...RELEASES, topic: `Topic ${index}` })
    expect((await save({ ...RELEASES, topic: 'One too many' })).status).toBe(409)
  })

  it('saves a principle for a channel only when the person is in it', async () => {
    await ana.api('POST', '/channels', { slug: 'billing', description: 'Billing' })
    const forBilling = { ...RELEASES, place: 'billing' }
    expect((await ben.api('POST', '/principles', forBilling)).status).toBe(404)
    expect((await ben.api('POST', '/principles', { ...RELEASES, place: 'nowhere' })).status).toBe(404)
    await ben.api('PUT', '/channels/billing/membership', {})
    expect((await ben.api('POST', '/principles', forBilling)).status).toBe(200)
    expect(await storedRows(server, 'principles')).toHaveLength(1)
  })

  it('holds the limit when many saves arrive at once', async () => {
    for (let index = 0; index < 45; index++) await save({ ...RELEASES, topic: `Topic ${index}` })
    const statuses = await Promise.all(
      Array.from(
        { length: 10 },
        async (_, index) => (await save({ ...RELEASES, topic: `At once ${index}` })).status,
      ),
    )
    expect(statuses.filter((status) => status === 200)).toHaveLength(5)
    expect(statuses.filter((status) => status === 409)).toHaveLength(5)
    const positions = (await storedRows(server, 'principles')).map((row) => Number(row.position))
    expect(positions).toHaveLength(50)
    expect(new Set(positions).size).toBe(50)
  })

  it('keeps one person’s principles from everyone else', async () => {
    const saved = (await save()).json
    expect((await ben.api('GET', '/principles')).json.principles).toEqual([])
    expect((await ben.api('PATCH', `/principles/${saved.id}`, { enabled: false })).status).toBe(404)
    expect((await ben.api('DELETE', `/principles/${saved.id}`)).status).toBe(404)
  })
})

describe('principles while drafting', () => {
  it('gives the agent its person’s enabled principles, this channel’s first, each group in the order they chose', async () => {
    await ana.api('POST', '/channels', { slug: 'releases', description: 'Releases' })
    const first = (await save()).json
    const second = (
      await save({
        topic: 'Freeze',
        rule: 'check the freeze calendar before naming a date',
        place: 'releases',
      })
    ).json
    const off = (await save({ topic: 'Off', rule: 'check nothing at all here please', place: null })).json
    await ana.api('PATCH', `/principles/${off.id}`, { enabled: false })
    const room = (await ana.api('GET', '/channels/releases')).json.conversationId
    const titles = async () =>
      (await anaAgent.api('GET', `/principles/drafting?conversationId=${room}`)).json.principles.map(
        (each: { topic: string }) => each.topic,
      )
    expect(await titles()).toEqual(['Freeze', 'Release dates'])
    expect(
      (await anaAgent.api('GET', '/principles/drafting')).json.principles.map(
        (each: { topic: string }) => each.topic,
      ),
    ).toEqual(['Release dates', 'Freeze'])
    const reordered = (await ana.api('PUT', '/principles/order', { ids: [off.id, second.id, first.id] })).json
    expect(reordered.principles.map((each: { topic: string }) => each.topic)).toEqual([
      'Off',
      'Freeze',
      'Release dates',
    ])
    expect(await titles()).toEqual(['Freeze', 'Release dates'])
    expect((await ana.api('PUT', '/principles/order', { ids: [first.id] })).status).toBe(400)
    expect((await ana.api('PUT', '/principles/order', { ids: [first.id, first.id, second.id] })).status).toBe(
      400,
    )
    const benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
    expect((await benAgent.api('GET', '/principles/drafting')).json.principles).toEqual([])
    const outside = await benAgent.api('GET', `/principles/drafting?conversationId=${room}`)
    expect(outside.status).toBe(400)
    expect(outside.json.error.message).toBe(
      'You are not in that conversation, so there are no principles to give for it.',
    )
  })
})

describe('renaming a channel', () => {
  it('moves its principles with it', async () => {
    await ana.api('POST', '/channels', { slug: 'billing', description: 'Billing' })
    await save({ ...RELEASES, place: 'billing' })
    await ana.api('PATCH', '/admin/channels/billing', { slug: 'invoices' })
    expect((await mine()).principles[0].place).toBe('invoices')
    expect((await storedRows(server, 'principles'))[0]!.place).toBe('invoices')
  })
})

describe('stored answers', () => {
  it('saves an answer as an item of the same list, up to 300 characters, or one taken from a source', async () => {
    const fixed = (
      await save({
        kind: 'answer',
        topic: 'Office hours',
        rule: `We are open ${'x'.repeat(270)}`,
        place: null,
      })
    ).json
    expect(fixed).toMatchObject({ kind: 'answer', topic: 'Office hours' })
    const fromSource = (
      await save({
        kind: 'answer',
        topic: 'Release dates',
        rule: '',
        source: 'https://wiki.example/releases',
        place: null,
      })
    ).json
    expect(fromSource).toMatchObject({ kind: 'answer', rule: '', source: 'https://wiki.example/releases' })
    expect((await save({ kind: 'answer', topic: 'Nothing', rule: '', place: null })).status).toBe(400)
    expect((await save({ kind: 'rule', topic: 'Too long', rule: 'x'.repeat(295), place: null })).status).toBe(
      400,
    )
    const longer = await save({ kind: 'answer', topic: 'Longer', rule: 'x'.repeat(295), place: null })
    expect(longer.status).toBe(400)
    expect(longer.json.error.message).toMatch(/at most 300 characters.*source/)
    const drafting = (await anaAgent.api('GET', '/principles/drafting')).json
    const text = principlesInstructions(drafting)
    expect(text).toContain('- Office hours: answer with: We are open')
    expect(text).toContain('- Release dates: take the answer from https://wiki.example/releases')
    expect(text).toContain('Your person still approves every draft.')
  })

  it('keeps a longer answer saved before the cap working, until an edit, which must shorten it', async () => {
    const saved = (await save({ kind: 'answer', topic: 'Office hours', rule: 'Open daily.', place: null }))
      .json
    const long = `We are open ${'x'.repeat(500)}`
    await T.runPromise(run(sql`UPDATE principles SET rule = ${long} WHERE id = ${saved.id}`), server.env)
    expect((await mine()).principles[0].rule).toBe(long)
    const drafting = (await anaAgent.api('GET', '/principles/drafting')).json
    expect(drafting.principles.map((one: { rule: string }) => one.rule)).toContain(long)
    const off = await ana.api('PATCH', `/principles/${saved.id}`, { enabled: false })
    expect(off.json).toMatchObject({ enabled: false, rule: long })
    expect((await ana.api('PATCH', `/principles/${saved.id}`, { enabled: true })).status).toBe(200)
    const retitled = await ana.api('PATCH', `/principles/${saved.id}`, { topic: 'Hours' })
    expect(retitled.status).toBe(400)
    expect(retitled.json.error.message).toMatch(/at most 300 characters/)
    const shortened = await ana.api('PATCH', `/principles/${saved.id}`, { rule: 'Open 9 to 5.' })
    expect(shortened.json).toMatchObject({ rule: 'Open 9 to 5.' })
  })

  it('switches a rule to an answer and back, and counts an applied answer by its title', async () => {
    const saved = (await save()).json
    const changed = (
      await ana.api('PATCH', `/principles/${saved.id}`, { kind: 'answer', rule: 'Tuesday 14:00 CET' })
    ).json
    expect(changed).toMatchObject({ kind: 'answer', rule: 'Tuesday 14:00 CET' })
    await agentDraft('Tuesday 14:00 CET.', 'Principles applied: Release dates')
    expect((await mine()).principles[0].counts.applied).toBe(1)
    expect(
      (await ana.api('PATCH', `/principles/${saved.id}`, { kind: 'rule', rule: 'x'.repeat(290) })).status,
    ).toBe(400)
  })
})

describe('saving public sentences', () => {
  const PUBLIC = 'My agent can tell you our release dates.'

  it('refuses a public sentence that repeats the private text or its source', async () => {
    const saved = (await save({ ...RELEASES, source: 'https://wiki.example/r' })).json
    for (const publicText of [
      'Check RELEASES.md and give weekday and time zone!',
      'See https://wiki.example/r for dates.',
      'x'.repeat(201),
      '   ',
    ])
      expect((await ana.api('PATCH', `/principles/${saved.id}`, { publicText })).status).toBe(400)
    expect((await save({ ...RELEASES, topic: 'Other', publicText: PUBLIC })).json.publicText).toBe(PUBLIC)
  })
})
