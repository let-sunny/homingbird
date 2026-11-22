import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

afterEach(() => server?.close())

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

describe('public sentences', () => {
  const PUBLIC = 'My agent can tell you our release dates.'

  it('shows colleagues only the sentence written for them, never the principle, its source or its channel', async () => {
    await ana.api('POST', '/channels', { slug: 'releases', description: 'Releases' })
    const saved = (await save({ ...RELEASES, source: 'https://wiki.example/r', place: 'releases' })).json
    await save({ ...RELEASES, topic: 'Private one' })
    expect((await ana.api('PATCH', `/principles/${saved.id}`, { publicText: PUBLIC })).json.publicText).toBe(
      PUBLIC,
    )
    const anaSeenBy = async (viewer: Session | Agent) =>
      (await viewer.api('GET', '/directory')).json.entries.find(
        (entry: { member: { id: string } }) => entry.member.id === ana.me.member.id,
      )
    for (const viewer of [ben, await connectAgent(server, ben, { name: 'Ben agent' })]) {
      const entry = await anaSeenBy(viewer)
      expect(entry.agentIntroduction).toEqual([PUBLIC])
      const text = JSON.stringify(entry)
      for (const secret of ['RELEASES.md', 'wiki.example', 'Private one', 'weekday'])
        expect(text).not.toContain(secret)
    }
    await ana.api('PATCH', `/principles/${saved.id}`, { enabled: false })
    expect((await anaSeenBy(ben)).agentIntroduction).toEqual([])
    await ana.api('PATCH', `/principles/${saved.id}`, { enabled: true, publicText: null })
    expect((await anaSeenBy(ben)).agentIntroduction).toEqual([])
  })

  it('shows nothing about anyone’s agent while teaching is switched off', async () => {
    await save({ ...RELEASES, publicText: PUBLIC })
    await switchTeaching(false)
    const entries = (await ben.api('GET', '/directory')).json.entries
    expect(
      entries.every((entry: { agentIntroduction: string[] }) => entry.agentIntroduction.length === 0),
    ).toBe(true)
  })
})
