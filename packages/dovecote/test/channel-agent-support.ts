import { type Agent, type Session, type TestServer, startTestServer } from './harness.ts'

export const CHANNEL = 'payments-wiki'

/**
 * A server with channel agents on and #payments-wiki, which Ana manages, with Ben and Cy in its room
 * answering nothing. Root, who signs in first, is the administrator.
 */
export const startWithChannel = async (
  overrides: Readonly<Record<string, string>> = {},
): Promise<{
  readonly server: TestServer
  readonly root: Session
  readonly ana: Session
  readonly ben: Session
  readonly cy: Session
}> => {
  const server = await startTestServer({ HB_FEATURES: 'channelAgents=on', ...overrides })
  const root = await server.signIn('root@example.com', 'Root')
  const ana = await server.signIn('ana@example.com', 'Ana')
  const ben = await server.signIn('ben@example.com', 'Ben')
  const cy = await server.signIn('cy@example.com', 'Cy')
  await ana.api('POST', '/channels', { slug: CHANNEL, description: 'Answers from the payments wiki' })
  await ben.api('PUT', `/channels/${CHANNEL}/membership`, {})
  await cy.api('PUT', `/channels/${CHANNEL}/membership`, {})
  return { server, root, ana, ben, cy }
}

/** Makes the channel's agent and issues it a credential through the device flow, approved by the manager. */
export const startAgent = async (
  server: TestServer,
  manager: Session,
  slug = CHANNEL,
  name = 'Payments wiki',
): Promise<Agent & { readonly id: string }> => {
  const made = await manager.api('PUT', `/channels/${slug}/agent`, { name })
  if (made.status !== 200 && made.status !== 409) throw new Error(`agent not made: ${made.status}`)
  const id: string = (await manager.api('GET', `/channels/${slug}/agent`)).json.agent.id
  return { id, ...(await issueAgentCredential(server, manager, slug)) }
}

export const issueAgentCredential = async (
  server: TestServer,
  manager: Session,
  slug = CHANNEL,
): Promise<Agent> => {
  const started = await server.request('POST', '/oauth/device_authorization', {
    form: { client_name: 'Wiki desk', scope: 'notes' },
  })
  const decided = await manager.api('POST', `/device/${started.json.user_code}`, {
    approve: true,
    name: 'Wiki desk',
    channel: slug,
  })
  if (decided.status !== 200)
    throw new Error(`device refused: ${decided.status} ${JSON.stringify(decided.json)}`)
  const tokens = await server.request('POST', '/oauth/token', {
    form: {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: started.json.device_code,
    },
  })
  const token: string = tokens.json.access_token
  return {
    token,
    api: (method, path, body) =>
      server.request(method, `/api/v1${path}`, { token, ...(body !== undefined && { body }) }),
  }
}

export const asRead = (note: { readonly body: string; readonly conversationId: string }) => ({
  body: note.body,
  conversationId: note.conversationId,
})

/** Cy asks in the channel; the agent answers; the answer waits for a manager. */
export const askAndDraft = async (
  asker: Session,
  agent: Agent,
  question = 'Where is the refund runbook?',
  answer = 'In the wiki under Refunds.',
): Promise<{ readonly question: any; readonly draft: any }> => {
  const asked = (await asker.api('POST', '/drafts', { channel: CHANNEL, body: question })).json
  const sent = (await asker.api('POST', `/drafts/${asked.id}/send`, { expected: asRead(asked) })).json
  const drafted = await agent.api('POST', '/drafts', {
    inReplyTo: sent.id,
    body: answer,
    basis: 'wiki/refunds.md',
  })
  return { question: sent, draft: drafted.json }
}
