import { afterEach, describe, expect, it } from 'vitest'
import { CHANNEL, asRead, startAgent, startWithChannel } from './channel-agent-support.ts'
import { type Agent, type Session, type TestServer, storeChannelAsPrivate, storedRows } from './harness.ts'

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

  it('names its asker and its current managers to the people in it, and to nobody else', async () => {
    await start()
    await setManagers([ana, ben])
    const room = (await askPrivately(cy)).json.id
    for (const person of [cy, ana, ben]) {
      const seen = (await person.api('GET', `/conversations/${room}`)).json
      expect(seen.askedBy).toBe(cy.me.member.id)
      expect(seen.managerIds).toEqual([ana.me.member.id, ben.me.member.id].sort())
    }
    const listed = (await cy.api('GET', '/conversations')).json.conversations
    expect(listed.find((one: any) => one.id === room)).toMatchObject({ askedBy: cy.me.member.id })
    expect((await root.api('GET', `/conversations/${room}`)).status).toBe(404)
    await setManagers([ben])
    expect((await cy.api('GET', `/conversations/${room}`)).json.managerIds).toEqual([ben.me.member.id])
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
    await storeChannelAsPrivate(server, CHANNEL)
    expect((await askPrivately(cy)).status).toBe(200)
    expect((await askPrivately(root)).status).toBe(404)
  })

  it('needs the channel to have an agent', async () => {
    await start()
    await ana.api('POST', '/channels', { slug: 'quiet', description: 'Quiet' })
    expect((await askPrivately(cy, 'quiet')).status).toBe(409)
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

  it('never lets the asker review an answer meant for them, even to a note another manager wrote', async () => {
    await start()
    await setManagers([ana, ben, cy])
    const room = (await askPrivately(ana)).json.id
    const bens = await send(ben, room, 'Ana, here is some context.')
    const draft = (await agent.api('POST', '/drafts', { inReplyTo: bens.id, body: 'For Ana only.' })).json
    expect((await ana.api('GET', '/reviews')).json.reviews).toEqual([])
    expect((await ana.api('GET', `/reviews/${draft.id}`)).status).toBe(404)
    expect((await ana.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).status).toBe(404)
    expect((await ben.api('GET', '/reviews')).json.reviews).toEqual([])
    expect((await ben.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).status).toBe(404)
    expect((await cy.api('GET', '/reviews')).json.reviews.map((review: any) => review.note.id)).toEqual([
      draft.id,
    ])
    expect(
      (await cy.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).json,
    ).toMatchObject({
      approvedBy: cy.me.member.id,
      receipts: [{ memberId: ana.me.member.id }],
    })
  })

  it('refuses the agent’s answer in a private question when nobody but its asker and the note’s author manages', async () => {
    await start()
    await setManagers([ana, ben])
    const room = (await askPrivately(ana)).json.id
    const bens = await send(ben, room, 'Ana, here is some context.')
    const refused = await agent.api('POST', '/drafts', { inReplyTo: bens.id, body: 'For Ana only.' })
    expect(refused.status).toBe(409)
  })

  it('closes the asker’s private questions when they leave the channel, discarding the answers waiting there', async () => {
    await start()
    const room = (await askPrivately(cy)).json.id
    const question = await send(cy, room, 'Is my refund stuck?')
    const draft = (await agent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Processing.' })).json
    expect((await cy.api('DELETE', `/channels/${CHANNEL}/membership`)).status).toBe(200)
    expect((await ana.api('GET', `/conversations/${room}`)).json.archivedAt).not.toBeNull()
    expect((await ana.api('GET', '/reviews')).json.reviews).toEqual([])
    expect((await storedRows(server, 'notes')).find((row) => row.id === draft.id)?.status).toBe('discarded')
    expect((await cy.api('POST', '/drafts', { conversationId: room, body: 'Hello?' })).status).toBe(409)
    expect((await agent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Again' })).status).toBe(409)
    await cy.api('PUT', `/channels/${CHANNEL}/membership`, {})
    expect((await askPrivately(cy)).json.id).not.toBe(room)
  })

  it('closes the private questions of someone a manager takes out of a private channel', async () => {
    await start()
    await storeChannelAsPrivate(server, CHANNEL)
    const room = (await askPrivately(cy)).json.id
    await send(cy, room, 'Is my refund stuck?')
    const other = (await askPrivately(ben)).json.id
    expect((await ana.api('DELETE', `/channels/${CHANNEL}/members/${cy.me.member.id}`)).status).toBe(200)
    expect((await ana.api('GET', `/conversations/${room}`)).json.archivedAt).not.toBeNull()
    expect((await ana.api('GET', `/conversations/${other}`)).json.archivedAt).toBeNull()
  })
})
