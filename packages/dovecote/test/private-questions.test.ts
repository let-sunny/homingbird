import { afterEach, describe, expect, it } from 'vitest'
import { CHANNEL, asRead, startAgent, startWithChannel } from './channel-agent-support.ts'
import { type Agent, type Session, type TestServer, storedRows } from './harness.ts'

let server: TestServer
let root: Session
let ana: Session
let ben: Session
let cy: Session
let agent: Agent & { readonly id: string }

const start = async () => {
  ;({ server, root, ana, ben, cy } = await startWithChannel())
  agent = await startAgent(server, ana)
}

const askPrivately = async (asker: Session, slug = CHANNEL) =>
  asker.api('POST', `/channels/${slug}/private-question`)

const send = async (author: Session, conversationId: string, body: string) => {
  const draft = (await author.api('POST', '/drafts', { conversationId, body })).json
  return (await author.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).json
}

const setManagers = async (people: ReadonlyArray<Session>) => {
  const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
  const by = people[0]!
  await by.api('PUT', `/groups/${group}/members`, { memberIds: people.map((person) => person.me.member.id) })
}

afterEach(async () => {
  await server.close()
})

describe('asking a channel’s agent privately', () => {
  it('opens a conversation of the asker, the agent and the managers, the same one each time', async () => {
    await start()
    const opened = await askPrivately(cy)
    expect(opened.status).toBe(200)
    expect(opened.json).toMatchObject({ kind: 'group', privateQuestionOf: CHANNEL })
    expect([...opened.json.participantIds].sort()).toEqual(
      [cy.me.member.id, agent.id, ana.me.member.id].sort(),
    )
    expect((await askPrivately(cy)).json.id).toBe(opened.json.id)
    expect((await ben.api('GET', `/conversations/${opened.json.id}`)).status).toBe(404)
    expect((await root.api('GET', `/conversations/${opened.json.id}`)).status).toBe(404)
  })

  it('delivers the question to the agent alone, and the approved answer to the asker alone', async () => {
    await start()
    await setManagers([ana, ben])
    const room = (await askPrivately(cy)).json.id
    const question = await send(cy, room, 'Is my refund stuck?')
    expect(question.receipts.map((receipt: any) => receipt.memberId)).toEqual([agent.id])
    expect((await ana.api('GET', '/inbox')).json.items).toEqual([])
    const draft = (await agent.api('POST', '/drafts', { inReplyTo: question.id, body: 'It is processing.' }))
      .json
    expect((await cy.api('GET', `/notes/${draft.id}`)).status).toBe(404)
    const [review] = (await ben.api('GET', '/reviews')).json.reviews
    expect(review).toMatchObject({ note: { id: draft.id }, privately: true, channel: CHANNEL })
    const answer = (await ben.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).json
    expect(answer).toMatchObject({ authorId: agent.id, approvedBy: ben.me.member.id })
    expect(answer.receipts.map((receipt: any) => receipt.memberId)).toEqual([cy.me.member.id])
  })

  it('follows the managers: a new one reads the history, one who left is taken out', async () => {
    await start()
    const room = (await askPrivately(cy)).json.id
    const question = await send(cy, room, 'Is my refund stuck?')
    await setManagers([ana, ben])
    const history = (await ben.api('GET', `/conversations/${room}/notes`)).json.notes
    expect(history.map((note: any) => note.id)).toEqual([question.id])
    await setManagers([ben])
    expect((await ana.api('GET', `/conversations/${room}`)).status).toBe(404)
    expect([...(await cy.api('GET', `/conversations/${room}`)).json.participantIds].sort()).toEqual(
      [cy.me.member.id, agent.id, ben.me.member.id].sort(),
    )
  })

  it('keeps the asker in their question when they manage the channel and stop', async () => {
    await start()
    await setManagers([ana, cy])
    const room = (await askPrivately(cy)).json.id
    await setManagers([ana])
    expect((await cy.api('GET', `/conversations/${room}`)).status).toBe(200)
  })

  it('is open in a private channel only to its members, administrators included', async () => {
    await start()
    await ana.api('PUT', `/channels/${CHANNEL}/visibility`, { visibility: 'private' })
    expect((await askPrivately(cy)).status).toBe(200)
    expect((await askPrivately(root)).status).toBe(404)
  })

  it('needs the channel to have an agent', async () => {
    await start()
    await ana.api('POST', '/channels', { slug: 'quiet', description: 'Quiet' })
    expect((await askPrivately(cy, 'quiet')).status).toBe(409)
  })

  it('keeps its questions where they are: none moves out of it', async () => {
    await start()
    const room = (await askPrivately(cy)).json.id
    const question = await send(cy, room, 'Is my refund stuck?')
    expect((await cy.api('POST', `/notes/${question.id}/move`, { channel: CHANNEL })).status).toBe(409)
  })

  it('stays readable to the asker and the managers when the channel is archived, without the agent', async () => {
    await start()
    const room = (await askPrivately(cy)).json.id
    const question = await send(cy, room, 'Is my refund stuck?')
    const draft = (await agent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Processing.' })).json
    await root.api('POST', `/admin/channels/${CHANNEL}/archive`, {})
    const read = (await cy.api('GET', `/conversations/${room}`)).json
    expect(read.archivedAt).not.toBeNull()
    expect(read.privateQuestionOf).toBeNull()
    expect([...read.participantIds].sort()).toEqual([cy.me.member.id, ana.me.member.id].sort())
    expect(
      (await ana.api('GET', `/conversations/${room}/notes`)).json.notes.map((note: any) => note.id),
    ).toEqual([question.id])
    expect((await storedRows(server, 'notes')).find((row) => row.id === draft.id)?.status).toBe('discarded')
    expect((await cy.api('POST', '/drafts', { conversationId: room, body: 'Hello?' })).status).toBe(409)
  })
})
