import { type Agent, type Session, type TestServer, connectAgent } from './harness.ts'

export interface Cast {
  readonly ana: Session
  readonly ben: Session
  readonly cy: Session
  readonly anaAgent: Agent & { readonly id: string }
  readonly benAgent: Agent & { readonly id: string }
  readonly cyAgent: Agent & { readonly id: string }
}

/** Three colleagues, each with one connected agent. */
export const castOf = async (server: TestServer): Promise<Cast> => {
  const ana = await server.signIn('ana@example.com', 'Ana')
  const ben = await server.signIn('ben@example.com', 'Ben')
  const cy = await server.signIn('cy@example.com', 'Cy')
  return {
    ana,
    ben,
    cy,
    anaAgent: await agentOf(server, ana, 'Ana agent'),
    benAgent: await agentOf(server, ben, 'Ben agent'),
    cyAgent: await agentOf(server, cy, 'Cy agent'),
  }
}

export const QUESTION = 'Should we ship the billing migration this week?'

export const LIMITS = { turnsPerAgent: 2, totalTurns: 4, minutes: 30, turnCharacters: 300 }

/** A room Ana opened, with Ana's and Ben's agents opted in by Ana and Ben. */
export const openedRoom = async (
  cast: Cast,
  options: { readonly visibility?: 'open' | 'private'; readonly limits?: typeof LIMITS } = {},
) => {
  const created = await cast.ana.api('POST', '/debates', {
    question: QUESTION,
    visibility: options.visibility ?? 'open',
    limits: options.limits ?? LIMITS,
    memberIds: [cast.ben.me.member.id],
  })
  if (created.status !== 200) throw new Error(JSON.stringify(created.json))
  await cast.ana.api('PUT', `/debates/${created.json.id}/agent`, { agentId: cast.anaAgent.id })
  await cast.ben.api('PUT', `/debates/${created.json.id}/agent`, { agentId: cast.benAgent.id })
  return created.json.id as string
}

/** Every turn the limits allow, alternating Ana's and Ben's agents. */
export const turnsRunOut = async (cast: Cast, id: string, count = LIMITS.totalTurns): Promise<void> => {
  for (let index = 0; index < count; index++) {
    const agent = index % 2 === 0 ? cast.anaAgent : cast.benAgent
    const taken = await agent.api('POST', `/debates/${id}/turns`, { body: `Turn ${index + 1}` })
    if (taken.status !== 200) throw new Error(JSON.stringify(taken.json))
  }
}

export const resultFor = (cast: Cast, kind: 'conclusion' | 'no_conclusion' = 'conclusion') => {
  const contributions = [
    { memberId: cast.ana.me.member.id, summary: 'Named the March incident report.', credits: ['gap_filled'] },
    {
      memberId: cast.ben.me.member.id,
      summary: 'Changed position after the report.',
      credits: ['position_changed'],
    },
  ]
  const nextSteps = [
    {
      step: 'Ben shares the rollback plan.',
      owner: cast.ben.me.member.id,
      proposedBy: cast.ana.me.member.id,
    },
  ]
  return kind === 'conclusion'
    ? {
        kind,
        conclusion: 'Ship on Thursday.',
        reasons: ['The rollback is tested.'],
        contributions,
        nextSteps,
      }
    : {
        kind,
        summary: 'They did not agree.',
        points: [{ point: 'Risk', category: 'goals', explanation: 'Speed against safety.' }],
        contributions,
        nextSteps,
      }
}

const agentOf = async (server: TestServer, owner: Session, name: string) => {
  const agent = await connectAgent(server, owner, { name })
  const me = (await agent.api('GET', '/me')).json
  return { ...agent, id: me.credential.id as string }
}

/** Approves or declines the result as the person read it, naming the draft they saw. */
export const decide = async (
  who: { readonly api: Session['api'] },
  id: string,
  how: 'approval' | 'decline',
  draftedAt?: number,
) => {
  const room = (await who.api('GET', `/debates/${id}`)).json
  return who.api('POST', `/debates/${id}/result/${how}`, {
    draftedAt: draftedAt ?? room.result?.draftedAt ?? 0,
  })
}
