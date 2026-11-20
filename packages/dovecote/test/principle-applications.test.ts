import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type Agent,
  type Session,
  type TestServer,
  asShown,
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

describe('principles a draft applied', () => {
  it('records the principles a draft’s basis says it applied, and what became of the draft', async () => {
    const saved = (await save()).json
    const kept = await agentDraft(
      'Tuesday 14:00 CET.',
      'Read RELEASES.md.\nPrinciples applied: release dates',
    )
    const edited = await agentDraft('Soon.', 'Principles applied: Release dates; Unknown')
    const thrown = await agentDraft('Maybe.', 'Principles applied: Release dates')
    await agentDraft('Not applied.', 'Read the wiki.')
    await ana.api('POST', `/drafts/${kept.id}/send`, await asShown(ana, kept.id))
    await ana.api('POST', `/drafts/${edited.id}/send`, await asShown(ana, edited.id, { body: 'Tuesday.' }))
    await ana.api('POST', `/drafts/${thrown.id}/discard`)
    const missed = await ana.api('POST', `/principles/${saved.id}/misses`, { noteId: edited.id })
    expect(missed.json.counts).toEqual({ applied: 3, sentAsWritten: 1, edited: 1, discarded: 1, missed: 1 })
    expect((await ana.api('POST', `/principles/${saved.id}/misses`, { noteId: kept.id })).status).toBe(200)
    const other = await agentDraft('Other.')
    expect((await ana.api('POST', `/principles/${saved.id}/misses`, { noteId: other.id })).status).toBe(404)
    expect((await mine()).principles[0].lastAppliedAt).not.toBeNull()
  })
})

describe('a revised basis', () => {
  it('replaces the draft’s earlier claims instead of adding to them, keeping a mark on a claim it keeps', async () => {
    const releases = (await save()).json
    const freeze = (await save({ ...RELEASES, topic: 'Freeze' })).json
    const draft = await agentDraft('Tuesday.', 'Principles applied: Release dates; Freeze')
    await ana.api('POST', `/principles/${releases.id}/misses`, { noteId: draft.id })
    await anaAgent.api('PATCH', `/drafts/${draft.id}`, {
      basis: 'Read it again. Principles applied: Release dates',
    })
    expect((await applications()).map((row) => [row.principle_id, row.missed_at !== null])).toEqual([
      [releases.id, true],
    ])
    await anaAgent.api('PATCH', `/drafts/${draft.id}`, { basis: 'No principle this time.' })
    expect(await applications()).toEqual([])
    expect(freeze.id).toMatch(/^prin_/)
  })
})

describe('with teaching switched off', () => {
  it('records no applications and offers no chance to teach', async () => {
    await save()
    await switchTeaching(false)
    const applied = await agentDraft('Tuesday at 14:00.', 'Principles applied: Release dates')
    await ana.api(
      'POST',
      `/drafts/${applied.id}/send`,
      await asShown(ana, applied.id, { body: 'The release ships on Tuesday at 14:00 CET.' }),
    )
    const thrown = await agentDraft('Wrong answer.')
    await ana.api('POST', `/drafts/${thrown.id}/discard`)
    expect(await applications()).toEqual([])
    expect(await storedRows(server, 'principle_offers')).toEqual([])
    await switchTeaching(true)
    const later = await agentDraft('Wrong again.', 'Principles applied: Release dates')
    await ana.api('POST', `/drafts/${later.id}/discard`)
    expect(await applications()).toHaveLength(1)
    expect(await storedRows(server, 'principle_offers')).toHaveLength(1)
  })
})
