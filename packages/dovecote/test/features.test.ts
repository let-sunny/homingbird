import { FEATURES, FEATURE_NAMES, FEATURE_OFF_MESSAGE } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

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

const switchTo = async (features: Readonly<Record<string, boolean>>) => {
  const settings = (await ana.api('GET', '/admin/settings')).json
  return ana.api('PUT', '/admin/settings', { ...settings, features })
}

let created = 0

/** One request per switch that reaches the feature's own route, as a person or an administrator. */
const probes: Readonly<Record<string, (person: Session) => Promise<{ status: number }>>> = {
  channels: (person) =>
    person.api('POST', '/channels', { slug: `billing-${++created}`, description: 'Billing' }),
  draftRequests: (person) => person.api('GET', '/draft-requests'),
  characters: (person) => person.api('DELETE', '/me/character'),
  webPush: (person) => person.api('GET', '/push/key'),
  answeringFlow: (person) => person.api('GET', '/answering-flow'),
  teaching: (person) => person.api('GET', '/principles'),
  agentFigures: (person) => person.api('GET', '/insights/me'),
  insights: (person) => person.api('GET', '/admin/insights'),
  debateRooms: (person) => person.api('GET', '/debates'),
}

describe('feature switches', () => {
  it('are all on by default, and server.info says which are on', async () => {
    const info = (await server.request('GET', '/api/v1/info')).json
    expect(info.features).toEqual(Object.fromEntries(FEATURE_NAMES.map((name) => [name, true])))
    await switchTo({ teaching: false })
    expect((await server.request('GET', '/api/v1/info')).json.features.teaching).toBe(false)
  })

  it.each(Object.keys(probes))(
    'refuses the routes of %s while it is off, and serves them when it is on',
    async (name) => {
      expect((await probes[name]!(ana)).status).toBe(200)
      await switchTo({ [name]: false })
      const refused = await probes[name]!(ana)
      expect(refused.status).toBe(404)
      expect((refused as { json?: { error?: { message?: string } } }).json?.error?.message).toBe(
        FEATURE_OFF_MESSAGE,
      )
      await switchTo({ [name]: true })
      expect((await probes[name]!(ana)).status).toBe(200)
    },
  )

  it('names a route for every switch that has one', () => {
    for (const name of FEATURE_NAMES)
      if (FEATURES[name].routes.length > 0) expect(Object.keys(probes)).toContain(name)
  })

  it('keeps a principle while teaching is off, and gives it back when it is on again', async () => {
    await ana.api('POST', '/principles', { topic: 'Release dates', rule: 'check RELEASES.md', place: null })
    await switchTo({ teaching: false })
    expect((await anaAgent.api('GET', '/principles/drafting')).status).toBe(404)
    await switchTo({ teaching: true })
    expect((await anaAgent.api('GET', '/principles/drafting')).json.principles).toHaveLength(1)
  })

  it('sends nobody else’s character while characters are off, and keeps the owner’s own', async () => {
    expect((await ben.api('PUT', '/me/character', OTTER)).status).toBe(200)
    const benSeenBy = async (viewer: Session) =>
      (await viewer.api('GET', '/directory')).json.entries.find(
        (entry: { member: { id: string } }) => entry.member.id === ben.me.member.id,
      ).member.character
    expect(await benSeenBy(ana)).toMatchObject({ id: 'my-otter' })
    await switchTo({ characters: false })
    expect(await benSeenBy(ana)).toBeNull()
    expect(await benSeenBy(ben)).toMatchObject({ id: 'my-otter' })
    expect((await ben.api('GET', '/me')).json.member.character).toMatchObject({ id: 'my-otter' })
    const members = (await ana.api('GET', '/admin/members')).json.members
    expect(members.find((member: { id: string }) => member.id === ben.me.member.id).character).toBeNull()
    const draft = (await ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'Hi' })).json
    await ben.api('POST', `/drafts/${draft.id}/send`, {})
    expect(JSON.stringify((await ana.api('GET', '/inbox')).json)).not.toContain('my-otter')
  })

  it('keeps a debate room while debate rooms are off, and refuses its agents’ routes too', async () => {
    const room = (await ana.api('POST', '/debates', { question: 'Ship this week?' })).json
    await switchTo({ debateRooms: false })
    expect((await anaAgent.api('GET', '/debate-asks')).status).toBe(404)
    expect((await anaAgent.api('POST', `/debates/${room.id}/turns`, { body: 'Yes.' })).status).toBe(404)
    expect((await ana.api('GET', '/principles')).json.debateCredits).toEqual([])
    await switchTo({ debateRooms: true })
    expect((await ana.api('GET', `/debates/${room.id}`)).json.question).toBe('Ship this week?')
  })

  it('shows no route map while it is off, and keeps the rest of teaching', async () => {
    await ana.api('POST', '/principles', { topic: 'Release dates', rule: 'check RELEASES.md', place: null })
    expect((await ana.api('GET', '/principles')).json.routes).toHaveLength(1)
    await switchTo({ routeMap: false })
    expect((await ana.api('GET', '/principles')).json.routes).toEqual([])
  })

  it('is switched by an administrator only, never by a member or an agent, and only for known features', async () => {
    const settings = (await ana.api('GET', '/admin/settings')).json
    expect(
      (await ben.api('PUT', '/admin/settings', { ...settings, features: { teaching: false } })).status,
    ).toBe(403)
    expect(
      (await anaAgent.api('PUT', '/admin/settings', { ...settings, features: { teaching: false } })).status,
    ).toBe(403)
    expect((await switchTo({ debates: false })).status).toBe(400)
    expect((await ana.api('GET', '/admin/settings')).json.features.teaching).toBe(true)
  })

  it('records every switch in the audit log', async () => {
    await switchTo({ characters: false })
    const entries = (await ana.api('GET', '/admin/audit?action=admin.settings.put')).json.entries
    expect(JSON.stringify(entries[0].detail)).toContain('"characters":false')
  })

  it('takes its starting switches from HB_FEATURES until an administrator saves settings', async () => {
    const seeded = await startTestServer({ HB_FEATURES: 'teaching=off' })
    try {
      expect((await seeded.request('GET', '/api/v1/info')).json.features.teaching).toBe(false)
    } finally {
      await seeded.close()
    }
  })
})

const OTTER = {
  version: 1,
  base: 'bubble-16',
  id: 'my-otter',
  name: 'Otter',
  palette: { B: '#8A6A52', D: '#6E523F', O: '#E7D3BF', F: '#6E523F' },
  noFeet: false,
  marks: [
    [5, 1, 1, 1, 'B'],
    [10, 1, 1, 1, 'B'],
    [15, 6, 1, 1, '#2E2018'],
  ],
}
