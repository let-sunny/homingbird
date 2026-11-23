import { FEATURE_OFF_MESSAGE } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ASKING_FIRST, type Cast, castOf } from './debate-support.ts'
import { type TestServer, connectAgent, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let cast: Cast

beforeEach(async () => {
  server = await startTestServer({ HB_FEATURES: 'schedulingRooms=on' })
  cast = await castOf(server)
})

afterEach(() => server?.close())

const MORNINGS = { from: 9 * 60, to: 12 * 60, timeZone: 'Asia/Seoul' }

const credentialIdOf = async (agent: { api: (method: string, path: string) => Promise<{ json: any }> }) =>
  (await agent.api('GET', '/me')).json.credential.id as string

describe('a person’s scheduling delegation', () => {
  it('is on with no limit until they change it, using their only agent', async () => {
    expect((await cast.ana.api('GET', '/me/scheduling')).json).toEqual({
      delegation: {
        autoJoin: true,
        autoAdd: true,
        agentId: null,
        brief: '',
        scope: { people: null, hours: null, maxMinutes: null },
      },
      agentInUse: cast.anaAgent.id,
    })
    expect(await storedRows(server, 'scheduling_delegations')).toEqual([])
  })

  it('uses the agent that drafted most recently, else the newest, and the one the person chose while it works', async () => {
    await server.clock.advance(1)
    const desktop = await connectAgent(server, cast.ana, { name: 'Ana desktop' })
    const desktopId = await credentialIdOf(desktop)
    const inUse = async () => (await cast.ana.api('GET', '/me/scheduling')).json.agentInUse
    expect(await inUse()).toBe(desktopId)
    await server.clock.advance(1)
    await cast.anaAgent.api('POST', '/drafts', { to: [cast.ben.me.member.id], body: 'Thursday works.' })
    expect(await inUse()).toBe(cast.anaAgent.id)
    const chosen = { ...ASKING_FIRST, autoJoin: true, agentId: desktopId }
    expect((await cast.ana.api('PUT', '/me/scheduling', chosen)).json.agentInUse).toBe(desktopId)
    await cast.ana.api('DELETE', `/credentials/${desktopId}`)
    expect(await inUse()).toBe(cast.anaAgent.id)
    await cast.ana.api('DELETE', `/credentials/${cast.anaAgent.id}`)
    expect(await inUse()).toBeNull()
  })

  it('keeps what the person set, the people in order and the brief trimmed', async () => {
    const { ana, ben, cy } = cast
    const wish = {
      autoJoin: false,
      autoAdd: true,
      agentId: cast.anaAgent.id,
      brief: '  Share mornings only.  ',
      scope: { people: [cy.me.member.id, ben.me.member.id], hours: MORNINGS, maxMinutes: 60 },
    }
    const set = await ana.api('PUT', '/me/scheduling', wish)
    const kept = {
      delegation: {
        ...wish,
        brief: 'Share mornings only.',
        scope: { ...wish.scope, people: [ben.me.member.id, cy.me.member.id].sort() },
      },
      agentInUse: cast.anaAgent.id,
    }
    expect(set.json).toEqual(kept)
    expect((await ana.api('GET', '/me/scheduling')).json).toEqual(kept)
    const unlimited = { ...ASKING_FIRST, brief: '   ' }
    expect((await ana.api('PUT', '/me/scheduling', unlimited)).json.delegation).toEqual({
      ...unlimited,
      brief: '',
    })
    expect(await storedRows(server, 'scheduling_delegation_people')).toEqual([])
  })

  it('refuses an agent that is not the person’s own and people who are not active, changing nothing', async () => {
    const { ana } = cast
    const refused = [
      { ...ASKING_FIRST, agentId: cast.benAgent.id },
      { ...ASKING_FIRST, scope: { ...ASKING_FIRST.scope, people: ['mem_nobody000000'] } },
      { ...ASKING_FIRST, scope: { ...ASKING_FIRST.scope, hours: { ...MORNINGS, timeZone: 'Mars/Base' } } },
    ]
    for (const body of refused)
      expect([body, (await ana.api('PUT', '/me/scheduling', body)).status]).toEqual([body, 400])
    expect(await storedRows(server, 'scheduling_delegations')).toEqual([])
  })

  it('records which parts changed, never their values', async () => {
    const { ana, ben } = cast
    await ana.api('PUT', '/me/scheduling', {
      ...ASKING_FIRST,
      brief: 'Secret zq7w',
      scope: { ...ASKING_FIRST.scope, people: [ben.me.member.id] },
    })
    await ana.api('PUT', '/me/scheduling', { ...ASKING_FIRST, brief: 'Secret zq7w', autoAdd: true })
    const recorded = (await storedRows(server, 'audit_events'))
      .filter((row) => row.event === 'scheduling.delegation_changed')
      .map((row) => [row.actor_id, row.target_id, JSON.parse(String(row.detail))])
    expect(recorded).toEqual([
      [ana.me.member.id, ana.me.member.id, { fields: ['autoJoin', 'autoAdd', 'brief', 'people'] }],
      [ana.me.member.id, ana.me.member.id, { fields: ['autoAdd', 'people'] }],
    ])
    expect(JSON.stringify(await storedRows(server, 'audit_events'))).not.toContain('zq7w')
  })

  it('is deleted when the person is deactivated', async () => {
    const { ana, ben } = cast
    await ben.api('PUT', '/me/scheduling', {
      ...ASKING_FIRST,
      scope: { ...ASKING_FIRST.scope, people: [ana.me.member.id] },
    })
    await ana.api('PUT', '/me/scheduling', {
      ...ASKING_FIRST,
      scope: { ...ASKING_FIRST.scope, people: [ben.me.member.id] },
    })
    expect(
      (await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { status: 'deactivated' })).status,
    ).toBe(200)
    expect((await storedRows(server, 'scheduling_delegations')).map((row) => row.member_id)).toEqual([
      ana.me.member.id,
    ])
    expect(await storedRows(server, 'scheduling_delegation_people')).toEqual([
      { member_id: ana.me.member.id, other_member_id: ben.me.member.id },
    ])
  })

  it('answers that the feature is off while scheduling rooms or debate rooms are off', async () => {
    const { ana } = cast
    const switched = async (features: Record<string, boolean>) => {
      const settings = (await ana.api('GET', '/admin/settings')).json
      await ana.api('PUT', '/admin/settings', {
        ...settings,
        features: { ...settings.features, ...features },
      })
    }
    for (const features of [{ schedulingRooms: false }, { schedulingRooms: true, debateRooms: false }]) {
      await switched(features)
      for (const [method, body] of [['GET'], ['PUT', ASKING_FIRST]] as const) {
        const answer = await ana.api(method, '/me/scheduling', body)
        expect([features, method, answer.status, answer.json.error.message]).toEqual([
          features,
          method,
          404,
          FEATURE_OFF_MESSAGE,
        ])
      }
    }
  })
})
