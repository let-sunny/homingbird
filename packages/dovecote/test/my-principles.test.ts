import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { achievementsOf } from '../src/domain/my-principles.ts'
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

describe('achievementsOf', () => {
  it('rewards teaching and careful reading, never volume or speed', () => {
    expect(achievementsOf([], 5, 0)).toEqual(['careful_week'])
    expect(achievementsOf([], 4, 0)).toEqual([])
    expect(achievementsOf([], 9, 1)).toEqual([])
  })
})

describe('with agent figures switched off', () => {
  it('lists principles without counts and without milestones', async () => {
    const saved = (await save()).json
    await agentDraft('Tuesday.', 'Principles applied: Release dates')
    expect((await mine()).principles[0].counts.applied).toBe(1)
    expect((await mine()).achievements).toContain('first_principle')
    const settings = (await ana.api('GET', '/admin/settings')).json
    await ana.api('PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, agentFigures: false },
    })
    const listed = await mine()
    expect(listed.principles[0].counts).toBeNull()
    expect(listed.achievements).toEqual([])
    expect(
      (await ana.api('PATCH', `/principles/${saved.id}`, { rule: 'check RELEASES.md' })).json.counts,
    ).toBeNull()
  })
})
