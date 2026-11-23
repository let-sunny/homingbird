import { FEATURE_OFF_MESSAGE, SHORT_DEBATE_LIMITS } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Cast, castOf } from './debate-support.ts'
import { type TestServer, connectAgent, startTestServer, storedRows } from './harness.ts'
import {
  SUGGESTED_QUESTION,
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

const switchTo = async (features: Readonly<Record<string, boolean>>) => {
  const settings = (await cast.ana.api('GET', '/admin/settings')).json
  await cast.ana.api('PUT', '/admin/settings', {
    ...settings,
    features: { ...settings.features, ...features },
  })
}

const waitingOf = async () => (await cast.ana.api('GET', '/debate-suggestions')).json.suggestions

describe('suggesting a short debate', () => {
  it('keeps the suggestion as a card for the agent’s person, naming the note, the colleagues and why', async () => {
    const question = await questionToAna(server, cast)
    const made = await cast.anaAgent.api('POST', '/debate-suggestions', {
      inReplyTo: question.id,
      question: `  ${SUGGESTED_QUESTION} `,
      memberIds: [cast.ben.me.member.id, cast.ana.me.member.id, cast.cy.me.member.id],
      reason: ' Cy ran the last migration. ',
    })
    expect(made.status).toBe(200)
    expect(made.json).toMatchObject({
      inReplyTo: question.id,
      conversationId: question.conversationId,
      draftId: null,
      question: SUGGESTED_QUESTION,
      memberIds: [cast.ben.me.member.id, cast.cy.me.member.id],
      reason: 'Cy ran the last migration.',
      agentName: 'Ana agent',
    })
    expect(made.json.id).toMatch(/^sugg_/)
    expect(await waitingOf()).toEqual([made.json])
    expect(await storedRows(server, 'debates')).toEqual([])
    expect((await cast.ben.api('GET', '/debate-suggestions')).json.suggestions).toEqual([])
  })

  it('names the answer its agent already drafted, which stays a draft', async () => {
    const question = await questionToAna(server, cast)
    const draft = (
      await cast.anaAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Frankfurt, probably.' })
    ).json
    const made = await cast.anaAgent.api('POST', '/debate-suggestions', {
      inReplyTo: question.id,
      question: SUGGESTED_QUESTION,
      memberIds: [cast.cy.me.member.id],
      reason: 'Cy knows the latency figures.',
      draftId: draft.id,
    })
    expect(made.json.draftId).toBe(draft.id)
    expect((await cast.ana.api('GET', `/notes/${draft.id}`)).json.status).toBe('draft')
  })

  it('refuses a person, who opens flocks themself in the web client', async () => {
    const question = await questionToAna(server, cast)
    const made = await cast.ana.api('POST', '/debate-suggestions', {
      inReplyTo: question.id,
      question: SUGGESTED_QUESTION,
      memberIds: [cast.cy.me.member.id],
      reason: 'Cy knows.',
    })
    expect(made.status).toBe(403)
    expect(await storedRows(server, 'debate_suggestions')).toEqual([])
  })

  it('refuses a blank question or reason, a note its person did not receive, someone else’s draft and no colleague', async () => {
    const question = await questionToAna(server, cast)
    const own = (await cast.ana.api('POST', '/drafts', { to: [cast.ben.me.member.id], body: 'Mine.' })).json
    const valid = {
      inReplyTo: question.id,
      question: SUGGESTED_QUESTION,
      memberIds: [cast.cy.me.member.id],
      reason: 'Cy knows.',
    }
    for (const body of [
      { ...valid, question: '   ' },
      { ...valid, reason: '  ' },
      { ...valid, inReplyTo: own.id },
      { ...valid, draftId: own.id },
      { ...valid, memberIds: [cast.ana.me.member.id] },
      { ...valid, memberIds: ['mem_nobody000000'] },
      { ...valid, place: 'lobby' },
    ])
      expect([body, (await cast.anaAgent.api('POST', '/debate-suggestions', body)).status]).toEqual([
        body,
        400,
      ])
    expect(await storedRows(server, 'debate_suggestions')).toEqual([])
  })

  it('leaves out the person who asked the note, and anyone across a block from its person', async () => {
    const question = await questionToAna(server, cast)
    const [asked] = (await storedRows(server, 'notes')).filter((row) => row.id === question.id)
    const body = { inReplyTo: question.id, question: SUGGESTED_QUESTION, reason: 'Cy knows.' }
    const withAsker = await cast.anaAgent.api('POST', '/debate-suggestions', {
      ...body,
      memberIds: [cast.cy.me.member.id, asked!.author_id],
    })
    expect([withAsker.status, withAsker.json.error.message]).toEqual([
      400,
      'Leave out the person who asked the note: they would read the flock before your human approves its answer.',
    ])
    await cast.cy.api('PUT', `/blocks/${cast.ana.me.member.id}`)
    const blocked = await cast.anaAgent.api('POST', '/debate-suggestions', {
      ...body,
      memberIds: [cast.ben.me.member.id, cast.cy.me.member.id],
    })
    expect([blocked.status, blocked.json.error.message]).toEqual([403, 'You cannot ask Cy to a flock.'])
    expect(await storedRows(server, 'debate_suggestions')).toEqual([])
    const made = await cast.anaAgent.api('POST', '/debate-suggestions', {
      ...body,
      memberIds: [cast.ben.me.member.id],
    })
    expect(made.json.askerId).toBe(asked!.author_id)
  })

  it('refuses a second suggestion about a note its person already decided on', async () => {
    const first = await suggestedByAna(server, cast)
    await cast.ana.api('DELETE', `/debate-suggestions/${first.id}`)
    const again = await cast.anaAgent.api('POST', '/debate-suggestions', {
      inReplyTo: first.inReplyTo,
      question: 'Again?',
      memberIds: [cast.cy.me.member.id],
      reason: 'Still unsure.',
    })
    expect([again.status, again.json.error.message]).toEqual([
      409,
      'Your human already decided on a debate about this note: answer it yourself.',
    ])
    expect(await storedRows(server, 'debate_suggestions')).toHaveLength(1)
  })

  it('keeps one waiting suggestion for each note', async () => {
    const first = await suggestedByAna(server, cast)
    const again = await cast.anaAgent.api('POST', '/debate-suggestions', {
      inReplyTo: first.inReplyTo,
      question: 'Again?',
      memberIds: [cast.cy.me.member.id],
      reason: 'Still unsure.',
    })
    expect(again.status).toBe(409)
    expect(await waitingOf()).toHaveLength(1)
  })

  it('answers 404 while suggestions or flocks are off', async () => {
    const question = await questionToAna(server, cast)
    const body = {
      inReplyTo: question.id,
      question: SUGGESTED_QUESTION,
      memberIds: [cast.cy.me.member.id],
      reason: 'Cy knows.',
    }
    for (const features of [{ debateSuggestions: false }, { debateSuggestions: true, debateRooms: false }]) {
      await switchTo(features)
      const refused = await cast.anaAgent.api('POST', '/debate-suggestions', body)
      expect([features, refused.status, refused.json.error.message]).toEqual([
        features,
        404,
        FEATURE_OFF_MESSAGE,
      ])
      expect((await cast.ana.api('GET', '/debate-suggestions')).status).toBe(404)
    }
  })
})

describe('opening the suggested flock', () => {
  it('opens a short private flock asking the suggested colleagues, with the suggesting agent in it', async () => {
    const suggestion = await suggestedByAna(server, cast)
    const opened = await cast.ana.api('POST', `/debate-suggestions/${suggestion.id}/accept`, {})
    expect(opened.status).toBe(200)
    expect(opened.json).toMatchObject({
      question: SUGGESTED_QUESTION,
      visibility: 'private',
      status: 'open',
      createdBy: cast.ana.me.member.id,
      limits: { turnsPerAgent: SHORT_DEBATE_LIMITS.turnsPerAgent, minutes: 30, graceMinutes: 5 },
      participants: [{ memberId: cast.ana.me.member.id, agentId: cast.anaAgent.id }],
    })
    expect([...opened.json.memberIds].sort()).toEqual(
      [cast.ana.me.member.id, cast.ben.me.member.id, cast.cy.me.member.id].sort(),
    )
    expect(await waitingOf()).toEqual([])
    const [row] = await storedRows(server, 'debate_suggestions')
    expect(row).toMatchObject({ decision: 'accepted', debate_id: opened.json.id, answered_at: null })
    expect((await storedRows(server, 'debates'))[0]).toMatchObject({ suggestion_id: suggestion.id })
    const audited = (await storedRows(server, 'audit_events')).filter(
      (entry) => entry.event === 'debate.suggestion_accepted',
    )
    expect(audited).toMatchObject([{ target_id: opened.json.id, actor_id: cast.ana.me.member.id }])
    expect(JSON.parse(String(audited[0]!.detail))).toEqual({ credentialId: cast.anaAgent.id, invited: 2 })
  })

  it('opens it with the question, the colleagues and the note on what the agent may use as the person edited them', async () => {
    const suggestion = await suggestedByAna(server, cast)
    const opened = (
      await cast.ana.api('POST', `/debate-suggestions/${suggestion.id}/accept`, {
        question: 'Frankfurt or Dublin for billing?',
        memberIds: [cast.cy.me.member.id],
        brief: 'Only the latency figures.',
      })
    ).json
    expect(opened).toMatchObject({
      question: 'Frankfurt or Dublin for billing?',
      brief: 'Only the latency figures.',
    })
    expect([...opened.memberIds].sort()).toEqual([cast.ana.me.member.id, cast.cy.me.member.id].sort())
    expect((await cast.ana.api('POST', `/debate-suggestions/${suggestion.id}/accept`, {})).status).toBe(404)
  })

  it('refuses a flock asking the person who asked the note, or someone across a block, and keeps the suggestion waiting', async () => {
    const suggestion = await suggestedByAna(server, cast)
    const [asked] = (await storedRows(server, 'notes')).filter((row) => row.id === suggestion.inReplyTo)
    const withAsker = await cast.ana.api('POST', `/debate-suggestions/${suggestion.id}/accept`, {
      memberIds: [cast.ben.me.member.id, asked!.author_id],
    })
    expect(withAsker.status).toBe(400)
    await cast.ana.api('PUT', `/blocks/${cast.cy.me.member.id}`)
    const blocked = await cast.ana.api('POST', `/debate-suggestions/${suggestion.id}/accept`, {})
    expect([blocked.status, blocked.json.error.message]).toEqual([403, 'You cannot ask Cy to a flock.'])
    expect(await waitingOf()).toHaveLength(1)
    expect(await storedRows(server, 'debates')).toEqual([])
  })

  it('marks the flock as opened from a suggestion, in the list and in the flock', async () => {
    const suggestion = await suggestedByAna(server, cast)
    const room = await acceptedByAna(server, cast, suggestion.id)
    expect((await cast.ben.api('GET', `/debates/${room.id}`)).json.fromSuggestion).toBe(true)
    expect((await cast.ben.api('GET', '/debates')).json.debates).toMatchObject([{ fromSuggestion: true }])
  })

  it('refuses a flock with no colleague, and keeps the suggestion waiting', async () => {
    const suggestion = await suggestedByAna(server, cast)
    const refused = await cast.ana.api('POST', `/debate-suggestions/${suggestion.id}/accept`, {
      memberIds: [cast.ana.me.member.id],
    })
    expect(refused.status).toBe(400)
    expect(await waitingOf()).toHaveLength(1)
    expect(await storedRows(server, 'debates')).toEqual([])
  })

  it('lets nobody else open or set aside a person’s suggestion', async () => {
    const suggestion = await suggestedByAna(server, cast)
    for (const [method, path] of [
      ['POST', `/debate-suggestions/${suggestion.id}/accept`],
      ['DELETE', `/debate-suggestions/${suggestion.id}`],
    ] as const)
      expect((await cast.ben.api(method, path, method === 'POST' ? {} : undefined)).status).toBe(404)
    expect(await waitingOf()).toHaveLength(1)
  })
})

describe('answering alone', () => {
  it('sets the suggestion aside, opens no flock and leaves the agent’s draft on its card', async () => {
    const question = await questionToAna(server, cast)
    const draft = (
      await cast.anaAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Frankfurt, probably.' })
    ).json
    const suggestion = (
      await cast.anaAgent.api('POST', '/debate-suggestions', {
        inReplyTo: question.id,
        question: SUGGESTED_QUESTION,
        memberIds: [cast.cy.me.member.id],
        reason: 'Cy knows.',
        draftId: draft.id,
      })
    ).json
    expect((await cast.ana.api('DELETE', `/debate-suggestions/${suggestion.id}`)).status).toBe(200)
    expect(await waitingOf()).toEqual([])
    expect(await storedRows(server, 'debates')).toEqual([])
    expect((await storedRows(server, 'debate_suggestions'))[0]).toMatchObject({ decision: 'dismissed' })
    expect((await cast.ana.api('GET', `/notes/${draft.id}`)).json.status).toBe('draft')
    expect((await cast.ana.api('DELETE', `/debate-suggestions/${suggestion.id}`)).status).toBe(404)
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toEqual([])
  })

  it('asks the suggesting agent alone to answer the note, until a reply to it is drafted or a day passed', async () => {
    const suggestion = await suggestedByAna(server, cast)
    await cast.ana.api('DELETE', `/debate-suggestions/${suggestion.id}`)
    const ask = {
      debateId: null,
      suggestionId: suggestion.id,
      inReplyTo: suggestion.inReplyTo,
      draftId: null,
      hasResult: false,
    }
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toEqual([ask])
    const another = await connectAgent(server, cast.ana, { name: 'Ana phone' })
    for (const other of [cast.benAgent, another])
      expect((await other.api('GET', '/debate-asks')).json.answers).toEqual([])
    const draft = (
      await cast.anaAgent.api('POST', '/drafts', { inReplyTo: suggestion.inReplyTo, body: 'Frankfurt.' })
    ).json
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toEqual([])
    await cast.ana.api('POST', `/drafts/${draft.id}/discard`, {})
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toEqual([ask])
    await server.clock.advance(24 * 60 * 60_000 + 1)
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toEqual([])
  })
})

describe('the answer a suggested flock asks for', () => {
  it('asks the suggesting agent alone once the flock closed, saying it has a result', async () => {
    const suggestion = await suggestedByAna(server, cast)
    const room = await acceptedByAna(server, cast, suggestion.id)
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toEqual([])
    expect((await closedWithResult(server, cast, room.id)).status).toBe('closed')
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toEqual([
      {
        debateId: room.id,
        suggestionId: suggestion.id,
        inReplyTo: suggestion.inReplyTo,
        draftId: null,
        hasResult: true,
      },
    ])
    for (const other of [cast.benAgent, cast.cyAgent, cast.ana])
      expect((await other.api('GET', '/debate-asks')).json.answers).toEqual([])
  })

  it('asks it to answer alone when the flock ended without a result, and stops asking after a day', async () => {
    const suggestion = await suggestedByAna(server, cast)
    const room = await acceptedByAna(server, cast, suggestion.id)
    expect((await endedWithoutResult(server, cast.ana, room.id)).status).toBe('ended')
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toMatchObject([
      { debateId: room.id, hasResult: false },
    ])
    await server.clock.advance(24 * 60 * 60_000 + 1)
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toEqual([])
  })

  it('asks nothing while suggestions are off', async () => {
    const suggestion = await suggestedByAna(server, cast)
    const room = await acceptedByAna(server, cast, suggestion.id)
    await endedWithoutResult(server, cast.ana, room.id)
    await switchTo({ debateSuggestions: false })
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.answers).toBeUndefined()
  })
})
