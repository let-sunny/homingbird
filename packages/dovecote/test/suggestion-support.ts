import { RESULT_DRAFTING_WINDOW_MS } from '@homingbird/protocol'
import { type Cast, resultFor } from './debate-support.ts'
import type { Session, TestServer } from './harness.ts'

export const SUGGESTED_QUESTION = 'Which region should the billing database move to?'

/** Ben asks Ana a question, sent; the note her agent will suggest a room about. */
export const questionToAna = async (cast: Cast, body = 'Where should the billing database live?') => {
  const draft = (await cast.ben.api('POST', '/drafts', { to: [cast.ana.me.member.id], body })).json
  const sent = await cast.ben.api('POST', `/drafts/${draft.id}/send`, {
    expected: { body: draft.body, conversationId: draft.conversationId },
  })
  if (sent.status !== 200) throw new Error(JSON.stringify(sent.json))
  return sent.json as { id: string; conversationId: string }
}

/** Ana's agent suggests talking Ben's question over with Ben's and Cy's agents. */
export const suggestedByAna = async (
  cast: Cast,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<{ id: string; inReplyTo: string; conversationId: string }> => {
  const question = await questionToAna(cast)
  const made = await cast.anaAgent.api('POST', '/debate-suggestions', {
    inReplyTo: question.id,
    question: SUGGESTED_QUESTION,
    memberIds: [cast.ben.me.member.id, cast.cy.me.member.id],
    reason: 'Cy ran the last migration and knows the latency figures.',
    ...overrides,
  })
  if (made.status !== 200) throw new Error(JSON.stringify(made.json))
  return made.json
}

/** Ana opens the room from the suggestion, and Ben opts his agent in. */
export const acceptedByAna = async (
  server: TestServer,
  cast: Cast,
  suggestionId: string,
  body: Readonly<Record<string, unknown>> = {},
): Promise<{ id: string }> => {
  const opened = await cast.ana.api('POST', `/debate-suggestions/${suggestionId}/accept`, body)
  if (opened.status !== 200) throw new Error(JSON.stringify(opened.json))
  await server.clock.advance(1)
  await cast.ben.api('PUT', `/debates/${opened.json.id}/agent`, { agentId: cast.benAgent.id })
  return opened.json
}

/** Both agents take their two turns and Ana's agent drafts the result alone, so the room closes with it. */
export const closedWithResult = async (server: TestServer, cast: Cast, id: string) => {
  for (let round = 0; round < 2; round++) {
    await cast.anaAgent.api('POST', `/debates/${id}/turns`, { body: `Frankfurt, round ${round}.` })
    await cast.benAgent.api('POST', `/debates/${id}/turns`, { body: `Agreed, round ${round}.` })
  }
  const drafted = await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
  if (drafted.status !== 200) throw new Error(JSON.stringify(drafted.json))
  await server.clock.advance(RESULT_DRAFTING_WINDOW_MS)
  return (await cast.ana.api('GET', `/debates/${id}`)).json
}

/** No agent takes a turn and the room's half hour passes, so it ends without a result. */
export const endedWithoutResult = async (server: TestServer, as: Session, id: string) => {
  await server.clock.advance(31 * 60_000)
  return (await as.api('GET', `/debates/${id}`)).json
}
