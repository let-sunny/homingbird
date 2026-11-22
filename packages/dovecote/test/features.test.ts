import { FEATURES, FEATURE_NAMES, FEATURE_OFF_MESSAGE } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type Agent,
  type Session,
  TEST_SECRETS_KEY,
  type TestServer,
  asShown,
  connectAgent,
  startTestServer,
  storedRows,
} from './harness.ts'

const SLACK_APP = {
  HB_SLACK_BOT_TOKEN: 'xoxb-1234-5678-botsecretvalue',
  HB_SLACK_SIGNING_SECRET: '8f742231b10e8888abcd99eeefff85a5',
}

let server: TestServer
let ana: Session
let ben: Session
let anaAgent: Agent

beforeEach(async () => {
  server = await startTestServer({ HB_SECRETS_KEY: TEST_SECRETS_KEY, ...SLACK_APP })
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
  mute: (person) => person.api('PUT', '/me/notifications', { notifications: 'all' }),
  webPush: (person) => person.api('GET', '/push/key'),
  answeringFlow: (person) => person.api('GET', '/answering-flow'),
  earlierAnswers: (person) => person.api('POST', '/answers/earlier', { question: 'release calendar' }),
  teaching: (person) => person.api('GET', '/principles'),
  agentFigures: (person) => person.api('GET', '/insights/me'),
  insights: (person) => person.api('GET', '/admin/insights'),
  debateRooms: (person) => person.api('GET', '/debates'),
  groups: (person) => person.api('GET', '/groups'),
  channelAgents: (person) => person.api('GET', '/reviews'),
  cloudDesk: (person) => person.api('GET', '/me/desk-wake'),
  slack: (person) => person.api('GET', '/me/slack'),
  joinCodes: (person) => person.api('POST', '/join-codes', {}),
  deskAvailability: (person) => person.api('POST', '/me/desk/available', {}),
  invites: (person) => person.api('GET', '/invites'),
  autoSend: async (person) => {
    const topic = `Office hours ${(probedAnswers += 1)}`
    const saved = (
      await person.api('POST', '/principles', { kind: 'answer', topic, rule: 'Nine to five.', place: null })
    ).json
    return person.api('PUT', `/principles/${saved.id}/auto-send`, { enabled: false, places: [] })
  },
  draftPreviews: (person) => person.api('GET', '/me/draft-previews'),
}

let probedAnswers = 0

describe('feature switches', () => {
  it('are all on by default but analytics, channel agents, the cloud desk, automatic sending, draft previews and Slack, and server.info says which are on', async () => {
    const info = (await server.request('GET', '/api/v1/info')).json
    expect(info.features).toEqual({
      ...Object.fromEntries(FEATURE_NAMES.map((name) => [name, true])),
      analytics: false,
      channelAgents: false,
      cloudDesk: false,
      autoSend: false,
      draftPreviews: false,
      slack: false,
    })
    await switchTo({ teaching: false })
    expect((await server.request('GET', '/api/v1/info')).json.features.teaching).toBe(false)
  })

  it.each(Object.keys(probes))(
    'refuses the routes of %s while it is off, and serves them when it is on',
    async (name) => {
      await switchTo({ [name]: true })
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

  it('names a route for every switch that has one; analytics, which also needs a destination, has its own tests', () => {
    for (const name of FEATURE_NAMES)
      if (FEATURES[name].routes.length > 0 && name !== 'analytics')
        expect(Object.keys(probes)).toContain(name)
  })

  it('refuses every route of groups while it is off, and keeps a channel’s managers and their members', async () => {
    const channel = (await ana.api('POST', '/channels', { slug: 'payroll', description: 'Payroll' })).json
    const group = channel.managedBy as string
    await switchTo({ groups: false })
    for (const [method, path, body] of [
      ['GET', '/groups', undefined],
      ['GET', `/groups/${group}`, undefined],
      ['PATCH', `/groups/${group}`, { name: 'Payroll' }],
      ['PUT', `/groups/${group}/members`, { memberIds: [ana.me.member.id, ben.me.member.id] }],
      ['PUT', '/channels/payroll/managers/team', { groupId: group }],
      ['POST', '/admin/groups', { name: 'Finance' }],
      ['DELETE', `/admin/groups/${group}`, undefined],
    ] as const) {
      const refused = await ana.api(method, path, body)
      expect([path, refused.status, refused.json?.error?.message]).toEqual([path, 404, FEATURE_OFF_MESSAGE])
    }
    expect((await ana.api('GET', '/channels/payroll')).json.managedBy).toBe(group)
    expect((await ana.api('GET', '/channels/payroll/members')).json.members).toEqual([
      { memberId: ana.me.member.id, answering: true, manager: true },
    ])
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
    await ben.api('POST', `/drafts/${draft.id}/send`, await asShown(ben, draft.id))
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

  it('records every switch in the audit trail, with its value before and after', async () => {
    await switchTo({ characters: false })
    const [entry] = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'organization.settings_changed',
    )
    const detail = JSON.parse(String(entry!.detail))
    expect(detail.changed).toEqual(['features'])
    expect([detail.features.from.characters, detail.features.to.characters]).toEqual([true, false])
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
