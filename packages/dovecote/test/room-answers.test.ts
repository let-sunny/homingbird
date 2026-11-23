import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Cast, castOf } from './debate-support.ts'
import { type TestServer, connectAgent, startTestServer, storedRows } from './harness.ts'
import {
  acceptedByAna,
  closedWithResult,
  endedWithoutResult,
  questionToAna,
  suggestedByAna,
} from './suggestion-support.ts'

let server: TestServer
let cast: Cast

beforeEach(async () => {
  server = await startTestServer({ HB_FEATURES: 'debateSuggestions=on' })
  cast = await castOf(server)
})

afterEach(() => server?.close())

const ANSWER = 'Frankfurt: the flock found it the closest with the latency we need.'

/** A suggestion Ana accepted, whose flock closed with a result. */
const closedRoom = async () => {
  const suggestion = await suggestedByAna(server, cast)
  const room = await acceptedByAna(server, cast, suggestion.id)
  await closedWithResult(server, cast, room.id)
  return { suggestion, room }
}

describe('drafting an answer from a suggested flock', () => {
  it('saves a draft that carries the flock, waits for its person, and ends the ask', async () => {
    const { suggestion, room } = await closedRoom()
    const draft = await cast.anaAgent.api('POST', '/drafts', {
      inReplyTo: suggestion.inReplyTo,
      body: ANSWER,
      debateId: room.id,
    })
    expect(draft.status).toBe(200)
    expect(draft.json).toMatchObject({ status: 'draft', inReplyTo: suggestion.inReplyTo })
    expect(draft.json.fromDebate).toMatchObject({ debateId: room.id })
    expect((await storedRows(server, 'notes')).find((note) => note.id === draft.json.id)).toMatchObject({
      debate_id: room.id,
    })
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toEqual([])
    const again = await cast.anaAgent.api('POST', '/drafts', {
      inReplyTo: suggestion.inReplyTo,
      body: ANSWER,
      debateId: room.id,
    })
    expect(again.status).toBe(409)
  })

  it('rewrites the draft saved before the flock, keeping the flock on it', async () => {
    const question = await questionToAna(server, cast)
    const before = (
      await cast.anaAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Frankfurt, probably.' })
    ).json
    const suggestion = (
      await cast.anaAgent.api('POST', '/debate-suggestions', {
        inReplyTo: question.id,
        question: 'Frankfurt or Dublin?',
        memberIds: [cast.ben.me.member.id],
        reason: 'Ben ran the last migration.',
        draftId: before.id,
      })
    ).json
    const room = await acceptedByAna(server, cast, suggestion.id)
    await endedWithoutResult(server, cast.ana, room.id)
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toMatchObject([
      { draftId: before.id, hasResult: false },
    ])
    const revised = await cast.anaAgent.api('PATCH', `/drafts/${before.id}`, {
      body: ANSWER,
      debateId: room.id,
    })
    expect(revised.status).toBe(200)
    expect(revised.json.fromDebate).toMatchObject({ debateId: room.id })
    const later = await cast.anaAgent.api('PATCH', `/drafts/${before.id}`, { body: `${ANSWER} Thanks.` })
    expect(later.json.fromDebate).toMatchObject({ debateId: room.id })
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toEqual([])
  })

  it('refuses a draft from a flock that is still open, before anything is saved', async () => {
    const suggestion = await suggestedByAna(server, cast)
    const room = await acceptedByAna(server, cast, suggestion.id)
    const early = await cast.anaAgent.api('POST', '/drafts', {
      inReplyTo: suggestion.inReplyTo,
      body: ANSWER,
      debateId: room.id,
    })
    expect(early.status).toBe(409)
    expect((await storedRows(server, 'notes')).filter((note) => note.body === ANSWER)).toEqual([])
  })

  it('refuses another agent, a person, another note, a flock no suggestion opened, and a request as well', async () => {
    const { suggestion, room } = await closedRoom()
    const other = await questionToAna(server, cast, 'And the backups?')
    const anotherOfAna = await connectAgent(server, cast.ana, { name: 'Ana phone' })
    const plain = (await cast.ana.api('POST', '/debates', { question: 'Plain flock?' })).json
    const attempts = [
      [cast.benAgent, { inReplyTo: suggestion.inReplyTo, debateId: room.id }, 403],
      [anotherOfAna, { inReplyTo: suggestion.inReplyTo, debateId: room.id }, 403],
      [cast.ana, { inReplyTo: suggestion.inReplyTo, debateId: room.id }, 403],
      [cast.anaAgent, { inReplyTo: other.id, debateId: room.id }, 400],
      [cast.anaAgent, { to: [cast.ben.me.member.id], debateId: room.id }, 400],
      [cast.anaAgent, { inReplyTo: suggestion.inReplyTo, debateId: plain.id }, 400],
      [
        cast.anaAgent,
        { inReplyTo: suggestion.inReplyTo, debateId: room.id, requestId: 'dreq_000000000000' },
        400,
      ],
    ] as const
    for (const [who, target, status] of attempts)
      expect([target, (await who.api('POST', '/drafts', { ...target, body: ANSWER })).status]).toEqual([
        target,
        status,
      ])
    expect((await storedRows(server, 'notes')).filter((note) => note.body === ANSWER)).toEqual([])
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toHaveLength(1)
  })

  it('answers 404 to a draft from a flock while suggestions are off', async () => {
    const { suggestion, room } = await closedRoom()
    const settings = (await cast.ana.api('GET', '/admin/settings')).json
    await cast.ana.api('PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, debateSuggestions: false },
    })
    const refused = await cast.anaAgent.api('POST', '/drafts', {
      inReplyTo: suggestion.inReplyTo,
      body: ANSWER,
      debateId: room.id,
    })
    expect(refused.status).toBe(404)
  })
})
