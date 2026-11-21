import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let cy: Session

beforeEach(async () => {
  server = await startTestServer({ HB_CHANNELS: 'wiki,deploys' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
  for (const person of [ana, ben, cy])
    for (const slug of ['wiki', 'deploys']) await person.api('PUT', `/channels/${slug}/membership`, {})
})

afterEach(() => server.close())

const send = async (author: Session, target: Record<string, unknown>, body: string) => {
  const draft = (await author.api('POST', '/drafts', { ...target, body })).json
  await server.clock.advance(1000)
  return (
    await author.api('POST', `/drafts/${draft.id}/send`, {
      expected: { body: draft.body, conversationId: draft.conversationId },
    })
  ).json
}

const askAndAnswer = async (slug: string, question: string, answer: string) => {
  const asked = await send(ana, { channel: slug }, question)
  const answered = await send(ben, { inReplyTo: asked.id }, answer)
  return { asked, answered }
}

const earlier = async (who: Session, ask: Record<string, unknown>) =>
  (await who.api('POST', '/answers/earlier', ask)).json.answers as ReadonlyArray<{
    readonly question: { readonly id: string; readonly body: string }
    readonly answer: { readonly id: string; readonly body: string; readonly approvedBy?: string | null }
    readonly channel: string | null
  }>

describe('earlier answers', () => {
  it('returns a sent answer whose question shares the words, with both notes and the channel it was in', async () => {
    const { asked, answered } = await askAndAnswer(
      'wiki',
      'Where do we keep the release calendar?',
      'In Drive, under Releases.',
    )
    const found = await earlier(cy, { question: 'Where is the release calendar kept?', channel: 'deploys' })
    expect(found).toEqual([
      {
        question: expect.objectContaining({ id: asked.id, body: asked.body }),
        answer: expect.objectContaining({ id: answered.id, body: 'In Drive, under Releases.' }),
        channel: 'wiki',
      },
    ])
  })

  it('returns nothing for a question of common words, or one sharing too few words', async () => {
    await askAndAnswer('wiki', 'Where do we keep the release calendar?', 'In Drive.')
    expect(await earlier(cy, { question: 'Where is it?' })).toEqual([])
    expect(await earlier(cy, { question: 'Who owns the billing calendar export?' })).toEqual([])
  })

  it('ranks the closest match first and shows at most three', async () => {
    await askAndAnswer('wiki', 'Release calendar for mobile?', 'Ask the mobile team.')
    await askAndAnswer('wiki', 'Release calendar?', 'In Drive.')
    await askAndAnswer('wiki', 'Release calendar again?', 'Still in Drive.')
    const best = await askAndAnswer('wiki', 'Where is the release calendar kept?', 'Kept in Drive.')
    await askAndAnswer('wiki', 'Release calendar link?', 'drive.example.com')
    const found = await earlier(cy, { question: 'Where is the release calendar kept?' })
    expect(found).toHaveLength(3)
    expect(found[0]!.answer.id).toBe(best.answered.id)
  })

  it('puts an equal match from the room the question goes to first', async () => {
    const inWiki = await askAndAnswer('wiki', 'Release calendar?', 'Wiki says Drive.')
    const inDeploys = await askAndAnswer('deploys', 'Release calendar?', 'Deploys says Drive.')
    expect((await earlier(cy, { question: 'release calendar', channel: 'wiki' }))[0]!.answer.id).toBe(
      inWiki.answered.id,
    )
    expect(
      (await earlier(cy, { question: 'release calendar', conversationId: inWiki.asked.conversationId }))[0]!
        .answer.id,
    ).toBe(inWiki.answered.id)
    expect((await earlier(cy, { question: 'release calendar', channel: 'deploys' }))[0]!.answer.id).toBe(
      inDeploys.answered.id,
    )
    expect((await earlier(cy, { question: 'release calendar', channel: 'nowhere' }))[0]!.answer.id).toBe(
      inDeploys.answered.id,
    )
  })

  it('never offers a reply its author wrote to their own question', async () => {
    const asked = await send(ana, { channel: 'wiki' }, 'Release calendar?')
    await send(ana, { inReplyTo: asked.id }, 'Found it: Drive.')
    expect(await earlier(cy, { question: 'release calendar' })).toEqual([])
  })

  it('counts a question answered from history once per person, room and answer, changing no note', async () => {
    const { answered } = await askAndAnswer('wiki', 'Release calendar?', 'In Drive.')
    const deploys = (await cy.api('GET', '/channels/deploys')).json.conversationId
    const notesBefore = await storedRows(server, 'notes')
    for (let i = 0; i < 2; i++)
      expect(
        (await cy.api('POST', `/answers/${answered.id}/used`, { conversationId: deploys })).json,
      ).toEqual({})
    expect(await storedRows(server, 'history_answers')).toEqual([
      expect.objectContaining({ member_id: cy.me.member.id, conversation_id: deploys, note_id: answered.id }),
    ])
    expect(await storedRows(server, 'notes')).toEqual(notesBefore)
  })
})
