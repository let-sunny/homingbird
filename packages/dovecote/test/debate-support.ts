import { Task as T } from '@homingbird/kernel'
import { RESULT_DRAFTING_WINDOW_MS } from '@homingbird/protocol'
import { dialect, run } from '../src/sql/database.ts'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { DEBATE_MODEL } from '../src/sql/migrations/debate-model-step.ts'
import { raw } from '../src/sql/query.ts'
import { schemaStatements } from '../src/sql/schema.ts'
import { type Agent, type Session, type TestServer, connectAgent, keepAwake } from './harness.ts'

export interface Cast {
  readonly ana: Session
  readonly ben: Session
  readonly cy: Session
  readonly anaAgent: Agent & { readonly id: string }
  readonly benAgent: Agent & { readonly id: string }
  readonly cyAgent: Agent & { readonly id: string }
  /** Stops the desk of this person's agent, stream and heartbeat, so it drops out once the grace passed. */
  readonly sleep: (who: 'ana' | 'ben' | 'cy') => void
  /** Opts an agent in a millisecond after the one before, so the room asks them in this order. */
  readonly optIn: (person: Session, id: string, agentId: string) => Promise<void>
  /** How long since the cast signed in, which is when the server started counting the grace. */
  readonly elapsed: () => number
}

/** One step past the default grace, and past the grace after the test server started. */
export const PAST_GRACE_MS = 5 * 60_000 + 1

/** Three colleagues, each with one connected agent taking part: its desk streams and sends heartbeats. */
export const castOf = async (server: TestServer): Promise<Cast> => {
  const ana = await server.signIn('ana@example.com', 'Ana')
  const ben = await server.signIn('ben@example.com', 'Ben')
  const cy = await server.signIn('cy@example.com', 'Cy')
  const anaAgent = await agentOf(server, ana, 'Ana agent')
  const benAgent = await agentOf(server, ben, 'Ben agent')
  const cyAgent = await agentOf(server, cy, 'Cy agent')
  const startedAt = server.clock.now()
  const streams = {
    ana: keepAwake(server, ana.me.member.id, anaAgent),
    ben: keepAwake(server, ben.me.member.id, benAgent),
    cy: keepAwake(server, cy.me.member.id, cyAgent),
  }
  return {
    ana,
    ben,
    cy,
    anaAgent,
    benAgent,
    cyAgent,
    sleep: (who) => streams[who](),
    elapsed: () => server.clock.now() - startedAt,
    optIn: async (person, id, agentId) => {
      await server.clock.advance(1)
      const opted = await person.api('PUT', `/debates/${id}/agent`, { agentId })
      if (opted.status !== 200) throw new Error(JSON.stringify(opted.json))
    },
  }
}

/** Stops the agent's desk and lets the grace pass, so it has dropped out; the others keep theirs. */
export const dropOut = async (server: TestServer, cast: Cast, who: 'ana' | 'ben' | 'cy'): Promise<void> => {
  cast.sleep(who)
  await server.clock.advance(PAST_GRACE_MS)
}

/**
 * Ana's agent drafts the result alone, and the room waits out the drafting window, so that draft goes to
 * the people: the room as it then stands.
 */
export const draftedAlone = async (
  server: TestServer,
  cast: Cast,
  id: string,
  result: unknown = resultFor(cast),
  agent: Agent = cast.anaAgent,
) => {
  const drafted = await agent.api('PUT', `/debates/${id}/result`, result)
  if (drafted.status !== 200) return drafted
  await server.clock.advance(RESULT_DRAFTING_WINDOW_MS)
  return cast.ana.api('GET', `/debates/${id}`)
}

export const QUESTION = 'Should we ship the billing migration this week?'

export const LIMITS = { turnsPerAgent: 2, totalTurns: 4, minutes: 30, turnCharacters: 300 }

/** A room Ana opened, with Ana's and Ben's agents opted in by Ana and Ben. */
export const openedRoom = async (
  cast: Cast,
  options: {
    readonly visibility?: 'open' | 'private'
    readonly limits?: typeof LIMITS & { readonly graceMinutes?: 5 | 10 | 30 }
  } = {},
) => {
  const created = await cast.ana.api('POST', '/debates', {
    question: QUESTION,
    visibility: options.visibility ?? 'open',
    limits: options.limits ?? LIMITS,
    memberIds: [cast.ben.me.member.id],
  })
  if (created.status !== 200) throw new Error(JSON.stringify(created.json))
  await cast.optIn(cast.ana, created.json.id, cast.anaAgent.id)
  await cast.optIn(cast.ben, created.json.id, cast.benAgent.id)
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

/** A room with Cy's agent opted in too, whose three agents each took their one turn. */
export const roomOfThree = async (cast: Cast): Promise<string> => {
  const created = await cast.ana.api('POST', '/debates', {
    question: 'Which week?',
    limits: { turnsPerAgent: 1, totalTurns: 3, minutes: 30, turnCharacters: 300 },
  })
  const id = created.json.id as string
  await cast.optIn(cast.ana, id, cast.anaAgent.id)
  await cast.optIn(cast.ben, id, cast.benAgent.id)
  await cast.optIn(cast.cy, id, cast.cyAgent.id)
  for (const agent of [cast.anaAgent, cast.benAgent, cast.cyAgent])
    await agent.api('POST', `/debates/${id}/turns`, { body: 'My view.' })
  return id
}

/** A result naming all three of Ana, Ben and Cy. */
export const threeResult = (cast: Cast, conclusion: string) => ({
  ...resultFor(cast),
  conclusion,
  contributions: [cast.ana, cast.ben, cast.cy].map((who) => ({
    memberId: who.me.member.id,
    summary: 'Spoke.',
    credits: [],
  })),
})

export const resultFor = (cast: Cast, kind: 'conclusion' | 'no_conclusion' = 'conclusion') => {
  const contributions = [
    {
      memberId: cast.ana.me.member.id,
      summary: 'Named the March incident report.',
      credits: [{ credit: 'gap_filled', turn: 1 }],
    },
    {
      memberId: cast.ben.me.member.id,
      summary: 'Changed position after the report.',
      credits: [{ credit: 'position_changed', turn: 2 }],
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

/** Adds the columns for the model an agent states in a room, unless the migrations already did. */
export const withStatedModels = async (server: TestServer): Promise<void> => {
  if (MIGRATIONS.includes(DEBATE_MODEL)) return
  const target = await T.runPromise(dialect, server.env)
  for (const statement of schemaStatements(target, [DEBATE_MODEL]))
    await T.runPromise(run(raw(statement)), server.env)
}

const agentOf = async (server: TestServer, owner: Session, name: string) => {
  const agent = await connectAgent(server, owner, { name })
  const me = (await agent.api('GET', '/me')).json
  return { ...agent, id: me.credential.id as string }
}
