import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TAGGING_OFF, TAGS_ONLY_IN_GROUPS, TAG_OUTSIDE_ROOM } from '../src/domain/note-tags.ts'
import { NOT_ASKED } from '../src/domain/receipts.ts'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import { asRead } from './channel-agent-support.ts'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let cy: Session
let dee: Session
let agents: Map<Session, Agent>

const start = async (overrides: Readonly<Record<string, string>> = {}) => {
  server = await startTestServer(overrides)
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
  dee = await server.signIn('dee@example.com', 'Dee')
  agents = new Map()
  for (const person of [ana, ben, cy, dee])
    agents.set(person, await connectAgent(server, person, { name: `${person.me.member.name} agent` }))
}

beforeEach(() => start())

afterEach(() => server.close())

const agentOf = (person: Session): Agent => agents.get(person)!

const startGroup = async (): Promise<string> =>
  (
    await ana.api('POST', '/conversations', {
      participantIds: [ben.me.member.id, cy.me.member.id, dee.me.member.id],
    })
  ).json.id

const send = async (from: Session, draft: Readonly<Record<string, unknown>>) => {
  const created = await from.api('POST', '/drafts', draft)
  expect(created.status).toBe(200)
  const sent = await from.api('POST', `/drafts/${created.json.id}/send`, { expected: asRead(created.json) })
  expect(sent.status).toBe(200)
  return sent.json
}

/** Who among these people finds the note in their agent's inbox. */
const handedTo = async (noteId: string, people: ReadonlyArray<Session>): Promise<string[]> => {
  const handed: string[] = []
  for (const person of people) {
    const { items } = (await agentOf(person).api('GET', '/inbox')).json
    if (items.some((item: { note: { id: string } }) => item.note.id === noteId))
      handed.push(person.me.member.name)
  }
  return handed
}

describe('who a group note asks', () => {
  it('hands a note that tags nobody to every reader’s agent, as before', async () => {
    const room = await startGroup()
    const note = await send(ana, { conversationId: room, body: 'Who has the release notes?' })
    expect(note.tags).toBeUndefined()
    expect(await handedTo(note.id, [ben, cy, dee])).toEqual(['Ben', 'Cy', 'Dee'])
  })

  it('hands a tagged note only to the tagged people’s agents, and shows it to every reader with its tags', async () => {
    const room = await startGroup()
    const tags = [cy.me.member.id, ben.me.member.id]
    const note = await send(ana, { conversationId: room, body: 'Ben, Cy: the release notes?', tags })
    expect(note.tags).toEqual([...tags].sort())
    expect(await handedTo(note.id, [ben, cy, dee])).toEqual(['Ben', 'Cy'])
    const seen = (await dee.api('GET', `/notes/${note.id}`)).json
    expect(seen.tags).toEqual([...tags].sort())
    expect(seen.receipts.map((receipt: { memberId: string }) => receipt.memberId)).toContain(dee.me.member.id)
    expect((await dee.api('GET', '/inbox')).json.items).toHaveLength(1)
  })

  it('refuses a pickup by an agent whose person the note does not tag, and lets the tagged pick up', async () => {
    const room = await startGroup()
    const note = await send(ana, { conversationId: room, body: 'Ben?', tags: [ben.me.member.id] })
    const refused = await agentOf(cy).api('POST', `/notes/${note.id}/pickup`)
    expect(refused.status).toBe(409)
    expect(refused.json.error.message).toBe(NOT_ASKED)
    expect((await agentOf(ben).api('POST', `/notes/${note.id}/pickup`)).status).toBe(200)
    expect((await cy.api('POST', `/notes/${note.id}/pickup`)).status).toBe(200)
  })

  it('lets a person’s own agent pick up a note stored before tags, which asks everyone', async () => {
    const room = await startGroup()
    const note = await send(ana, { conversationId: room, body: 'Anyone?' })
    await T.runPromise(run(sql`UPDATE receipts SET asked = NULL WHERE note_id = ${note.id}`), server.env)
    expect(await handedTo(note.id, [ben, cy, dee])).toEqual(['Ben', 'Cy', 'Dee'])
    expect((await agentOf(cy).api('POST', `/notes/${note.id}/pickup`)).status).toBe(200)
  })

  it('asks only the author of the note a reply answers when the reply tags nobody', async () => {
    const room = await startGroup()
    const asked = await send(ana, { conversationId: room, body: 'Who has the release notes?' })
    const draft = (await agentOf(ben).api('POST', '/drafts', { inReplyTo: asked.id, body: 'I do.' })).json
    expect(draft.tags).toEqual([ana.me.member.id])
    const reply = (await ben.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).json
    expect(reply.tags).toEqual([ana.me.member.id])
    expect(await handedTo(reply.id, [ana, cy, dee])).toEqual(['Ana'])
  })

  it('lets a reply tag other people in place of the author it answers', async () => {
    const room = await startGroup()
    const asked = await send(ana, { conversationId: room, body: 'Who has the release notes?' })
    const reply = await send(ben, { inReplyTo: asked.id, body: 'Dee does.', tags: [dee.me.member.id] })
    expect(await handedTo(reply.id, [ana, cy, dee])).toEqual(['Dee'])
  })

  it('asks everyone when a reply answers its own author’s note, and never tags the author', async () => {
    const room = await startGroup()
    const asked = await send(ana, { conversationId: room, body: 'Release at five.' })
    const reply = await send(ana, { inReplyTo: asked.id, body: 'Correction: six.', tags: [ana.me.member.id] })
    expect(reply.tags).toBeUndefined()
    expect(await handedTo(reply.id, [ben, cy, dee])).toEqual(['Ben', 'Cy', 'Dee'])
  })

  it('asks everyone when the author a reply answers has left the group', async () => {
    const room = await startGroup()
    await send(ana, { conversationId: room, body: 'Release at five.' })
    const asked = await send(ben, { conversationId: room, body: 'Who has the release notes?' })
    expect((await ben.api('POST', `/conversations/${room}/leave`)).status).toBe(200)
    const reply = await send(ana, { inReplyTo: asked.id, body: 'I do.' })
    expect(reply.tags).toBeUndefined()
    expect(await handedTo(reply.id, [cy, dee])).toEqual(['Cy', 'Dee'])
  })

  it('lets the person change the tags of a draft before sending it', async () => {
    const room = await startGroup()
    const draft = (await ana.api('POST', '/drafts', { conversationId: room, body: 'Ready?' })).json
    const changed = await ana.api('PATCH', `/drafts/${draft.id}`, { tags: [dee.me.member.id] })
    expect(changed.json.tags).toEqual([dee.me.member.id])
    const cleared = await ana.api('PATCH', `/drafts/${draft.id}`, { tags: [] })
    expect(cleared.json.tags).toBeUndefined()
    const kept = await ana.api('PATCH', `/drafts/${draft.id}`, { body: 'Ready now?' })
    expect(kept.json.tags).toBeUndefined()
  })
})

describe('where tags are refused', () => {
  it('refuses tags in a direct message, which has one reader', async () => {
    const created = await ana.api('POST', '/drafts', {
      to: [ben.me.member.id],
      body: 'Hi',
      tags: [ben.me.member.id],
    })
    expect(created.status).toBe(400)
    expect(created.json.error.message).toBe(TAGS_ONLY_IN_GROUPS)
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Hi' })).json
    expect(draft.tags).toBeUndefined()
  })

  it('refuses a tag of someone outside the group, so a tag never adds a reader', async () => {
    const room = (
      await ana.api('POST', '/conversations', { participantIds: [ben.me.member.id, cy.me.member.id] })
    ).json.id
    const created = await ana.api('POST', '/drafts', {
      conversationId: room,
      body: 'Dee?',
      tags: [dee.me.member.id],
    })
    expect(created.status).toBe(400)
    expect(created.json.error.message).toBe(TAG_OUTSIDE_ROOM)
  })

  it('refuses tags while tagging is off, and then asks every reader', async () => {
    await server.close()
    await start({ HB_FEATURES: 'tagging=off' })
    const room = await startGroup()
    const created = await ana.api('POST', '/drafts', {
      conversationId: room,
      body: 'Ben?',
      tags: [ben.me.member.id],
    })
    expect(created.status).toBe(400)
    expect(created.json.error.message).toBe(TAGGING_OFF)
    const asked = await send(ana, { conversationId: room, body: 'Anyone?' })
    const reply = await send(ben, { inReplyTo: asked.id, body: 'Me.' })
    expect(reply.tags).toBeUndefined()
    expect(await handedTo(reply.id, [ana, cy, dee])).toEqual(['Ana', 'Cy', 'Dee'])
  })

  it('asks every reader of a tagged note stored while tagging was on, once it is off', async () => {
    const room = await startGroup()
    const draft = (
      await ana.api('POST', '/drafts', { conversationId: room, body: 'Ben?', tags: [ben.me.member.id] })
    ).json
    const settings = (await ana.api('GET', '/admin/settings')).json
    const off = { ...settings, features: { ...settings.features, tagging: false } }
    expect((await ana.api('PUT', '/admin/settings', off)).status).toBe(200)
    const sent = await ana.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })
    expect(sent.status).toBe(200)
    expect(await handedTo(draft.id, [ben, cy, dee])).toEqual(['Ben', 'Cy', 'Dee'])
  })
})
