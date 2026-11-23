import { Task as T } from '@homingbird/kernel'
import { MemberId, type RouteName, contract } from '@homingbird/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { requireNotAgent } from '../src/domain/member-kinds.ts'
import { CHANNEL, startAgent, startWithChannel } from './channel-agent-support.ts'
import { type Session, type TestServer, storeChannelAsPrivate } from './harness.ts'

let server: TestServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

/** Every route whose request names a member: in its path, or anywhere in its body or query. */
const routesNamingAMember = (Object.keys(contract) as RouteName[]).filter((name) => {
  const route = contract[name] as {
    readonly path: string
    readonly body?: { ast: unknown }
    readonly query?: unknown
  }
  const schemas = JSON.stringify([route.body?.ast, route.query], (_, value) =>
    value instanceof RegExp ? value.source : value,
  )
  return (
    /:memberId/.test(route.path) ||
    /^\/admin\/members\/:id/.test(route.path) ||
    schemas.includes(`${MemberId.prefix}_`)
  )
})

type Probe = (
  people: { readonly ana: Session; readonly root: Session },
  agentId: string,
  group: string,
) => Promise<number>

/** How each of those routes is asked to take a channel's agent where a person belongs, and what it answers. */
const PROBES: Readonly<Partial<Record<RouteName, { readonly status: number; readonly probe: Probe }>>> = {
  'channels.members.add': {
    status: 404,
    probe: ({ ana }, id) => status(ana, 'PUT', `/channels/${CHANNEL}/members/${id}`),
  },
  'channels.members.remove': {
    status: 404,
    probe: ({ ana }, id) => status(ana, 'DELETE', `/channels/${CHANNEL}/members/${id}`),
  },
  'groups.members.set': {
    status: 404,
    probe: ({ ana }, id, group) =>
      status(ana, 'PUT', `/groups/${group}/members`, { memberIds: [ana.me.member.id, id] }),
  },
  'contacts.request': {
    status: 404,
    probe: ({ ana }, id) => status(ana, 'POST', '/contacts', { memberId: id }),
  },
  'contacts.accept': { status: 404, probe: ({ ana }, id) => status(ana, 'POST', `/contacts/${id}/accept`) },
  'blocks.add': { status: 404, probe: ({ ana }, id) => status(ana, 'PUT', `/blocks/${id}`) },
  'conversations.create': {
    status: 403,
    probe: ({ ana }, id) => status(ana, 'POST', '/conversations', { participantIds: [id] }),
  },
  'drafts.create': {
    status: 403,
    probe: ({ ana }, id) => status(ana, 'POST', '/drafts', { to: [id], body: 'Hi' }),
  },
  'draftRequests.create': {
    status: 403,
    probe: ({ ana }, id) => status(ana, 'POST', '/draft-requests', { to: [id] }),
  },
  'admin.groups.create': {
    status: 404,
    probe: ({ root }, id) => status(root, 'POST', '/admin/groups', { name: 'Agents', memberIds: [id] }),
  },
  'admin.members.update': {
    status: 404,
    probe: ({ root }, id) => status(root, 'PATCH', `/admin/members/${id}`, { status: 'deactivated' }),
  },
  'admin.members.resetCharacter': {
    status: 404,
    probe: ({ root }, id) => status(root, 'DELETE', `/admin/members/${id}/character`),
  },
  'me.draftPreviews.set': {
    status: 400,
    probe: async ({ ana, root }, id) => {
      const settings = (await root.api('GET', '/admin/settings')).json
      await root.api('PUT', '/admin/settings', {
        ...settings,
        features: { ...settings.features, draftPreviews: true },
      })
      return status(ana, 'PUT', '/me/draft-previews', { people: [id], channels: [] })
    },
  },
  'debates.create': {
    status: 400,
    probe: ({ ana }, id) => status(ana, 'POST', '/debates', { question: 'Which runbook?', memberIds: [id] }),
  },
  'scheduling.create': {
    status: 400,
    probe: async ({ ana, root }, id) => {
      const settings = (await root.api('GET', '/admin/settings')).json
      await root.api('PUT', '/admin/settings', {
        ...settings,
        features: { ...settings.features, schedulingRooms: true },
      })
      return status(ana, 'POST', '/scheduling-rooms', {
        title: 'Plan the runbook',
        minutes: 30,
        window: { startsAt: YEAR_2100, endsAt: YEAR_2100 + 24 * 60 * 60_000 },
        attendees: [{ memberId: id, required: true }],
      })
    },
  },
}

const YEAR_2100 = Date.UTC(2100, 0, 1)

/** Routes that may answer otherwise, and why that lets no agent in where a person belongs. */
const ALLOWED: Readonly<Partial<Record<RouteName, string>>> = {
  'contacts.remove': 'Removing a contact that does not exist changes nothing.',
  'blocks.remove': 'Removing a block that does not exist changes nothing.',
  'debates.result.draft': 'Names only the members of a debate room, which no channel’s agent can join.',
  'debates.result.vote': 'Names only the members of a debate room, which no channel’s agent can join.',
  'debates.result.post': 'Its `to` goes through the same draft destination as drafts.create.',
  'debateSuggestions.create':
    'Its colleagues pass the same check of active people as debates.create, probed above, before anything is kept.',
  'debateSuggestions.accept': 'It opens the room through debates.create, probed above, with the same check.',
  'drafts.update': 'Its tags name only people in a group message, which no channel’s agent can be in.',
  'drafts.send': 'Its tags are only compared with the draft’s, which name only people in a group message.',
}

const status = async (person: Session, method: string, path: string, body?: unknown) =>
  (await person.api(method, path, body)).status

describe('the routes that name a member', () => {
  it('are each probed with a channel’s agent here or allowed with a reason, and none is left out', () => {
    expect([...routesNamingAMember].sort()).toEqual([...Object.keys(PROBES), ...Object.keys(ALLOWED)].sort())
    for (const reason of Object.values(ALLOWED)) expect(reason).toMatch(/\.$/)
  })

  it('refuse a channel’s agent wherever only a person may be named', async () => {
    const started = await startWithChannel()
    server = started.server
    const { ana, root } = started
    const agent = await startAgent(started.server, ana)
    await storeChannelAsPrivate(started.server, CHANNEL)
    const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
    for (const [name, { status: expected, probe }] of Object.entries(PROBES))
      expect([name, await probe({ ana, root }, agent.id, group!)]).toEqual([name, expected])
    expect((await agent.api('GET', '/me')).status).toBe(200)
    expect((await ana.api('GET', `/channels/${CHANNEL}`)).json.agent.id).toBe(agent.id)
  })
})

describe('requireNotAgent', () => {
  it('lets through a person and an unknown id, and refuses a channel’s agent as no member', async () => {
    const started = await startWithChannel()
    server = started.server
    const agent = await startAgent(started.server, started.ana)
    const check = (id: string) => T.runPromise(T.result(requireNotAgent(id as MemberId)), started.server.env)
    expect(await check(started.ana.me.member.id)).toMatchObject({ _tag: 'Ok' })
    expect(await check('mem_nobody000000')).toMatchObject({ _tag: 'Ok' })
    expect(await check(agent.id)).toMatchObject({ _tag: 'Err', error: { _tag: 'NotFound' } })
  })
})
