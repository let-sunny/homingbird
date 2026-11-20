import { afterEach, describe, expect, it } from 'vitest'
import { CHANNEL, asRead, askAndDraft, startAgent, startWithChannel } from './channel-agent-support.ts'
import type { Session, TestServer } from './harness.ts'

let server: TestServer

afterEach(async () => {
  await server.close()
})

const reviewChanges = (memberId: string) => {
  const open = new AbortController()
  const changes: Array<string | null> = []
  const subscription = server.env.hub.subscribe(memberId as never, 'hidden', open.signal)
  void (async () => {
    for await (const event of subscription)
      if (event.body.type === 'review.changed') changes.push(event.body.noteId)
  })()
  return { changes, stop: () => open.abort() }
}

const addManager = async (ana: Session, person: Session) => {
  const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
  await ana.api('PUT', `/groups/${group}/members`, { memberIds: [ana.me.member.id, person.me.member.id] })
}

describe('telling reviewers', () => {
  it('tells the managers who may review, never the asker, when an answer is drafted, changed and sent', async () => {
    const started = await startWithChannel()
    server = started.server
    const { ana, ben } = started
    await addManager(ana, ben)
    const agent = await startAgent(server, ana)
    const toAna = reviewChanges(ana.me.member.id)
    const toBen = reviewChanges(ben.me.member.id)
    const { draft } = await askAndDraft(ben, agent)
    await agent.api('PATCH', `/drafts/${draft.id}`, { body: 'Changed' })
    await ana.api('POST', `/drafts/${draft.id}/send`, { expected: { ...asRead(draft), body: 'Changed' } })
    await server.clock.flush()
    toAna.stop()
    toBen.stop()
    expect(toAna.changes).toEqual([draft.id, draft.id, draft.id])
    expect(toBen.changes).toEqual([])
  })

  it('tells the managers the whole list changed when the agent retires', async () => {
    const started = await startWithChannel()
    server = started.server
    const { ana } = started
    await startAgent(server, ana)
    const toAna = reviewChanges(ana.me.member.id)
    await ana.api('DELETE', `/channels/${CHANNEL}/agent`)
    await server.clock.flush()
    toAna.stop()
    expect(toAna.changes).toEqual([null])
  })
})
