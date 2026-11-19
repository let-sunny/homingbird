import { Task as T, systemClock } from '@homingbird/kernel'
import { CredentialId, type Debate, DebateId, MemberId } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approveResult,
  createDebate,
  declineResult,
  exportDebate,
  loadDebate,
  loadDebates,
  optInAgent,
  postResult,
} from '../src/debate-actions.ts'
import { debates, debatesLoaded, shownDebate } from '../src/state.ts'

const ANA = MemberId.of('ana000000000')
const ID = DebateId.of('debate000000')

const ROOM: Debate = {
  id: ID,
  question: 'Ship?',
  visibility: 'open',
  status: 'concluding',
  createdBy: ANA,
  createdAt: 1,
  deadlineAt: 2,
  concludedAt: 2,
  closedAt: null,
  endedBecause: null,
  limits: { turnsPerAgent: 2, totalTurns: 4, minutes: 30, turnCharacters: 300 },
  memberIds: [ANA],
  participants: [],
  turns: [],
  result: null,
  resultRound: 0,
  approvals: [],
}

interface Sent {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

let sent: Sent[]
let answers: Array<{ readonly status: number; readonly body: unknown }>

beforeEach(() => {
  sent = []
  answers = []
  shownDebate.set(null)
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    sent.push({
      method: init.method ?? 'GET',
      path: new URL(url, 'http://localhost').pathname,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    const answer = answers.shift() ?? { status: 200, body: ROOM }
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    })
  })
})

afterEach(() => vi.unstubAllGlobals())

const run = <A>(action: T.Task<A, unknown, never>) => T.run(action, { clock: systemClock } as never)

describe('debate room actions', () => {
  it('loads the list of rooms and marks it loaded', async () => {
    answers.push({ status: 200, body: { debates: [] } })
    await run(loadDebates)
    expect(debates.get()).toEqual([])
    expect(debatesLoaded.get()).toBe(true)
  })

  it('shows a room, or shows it as missing when the person may not see it', async () => {
    await run(loadDebate(ID))
    expect(shownDebate.get()).toEqual(ROOM)
    answers.push({ status: 404, body: { error: { code: 'not_found', message: 'No such debate room.' } } })
    await run(loadDebate(ID))
    expect(shownDebate.get()).toBe('missing')
  })

  it('names the draft the person read when approving or declining it', async () => {
    await run(approveResult(ID, 42))
    await run(declineResult(ID, 43))
    expect(sent.map((one) => [one.method, one.path, one.body])).toEqual([
      ['POST', `/api/v1/debates/${ID}/result/approval`, { draftedAt: 42 }],
      ['POST', `/api/v1/debates/${ID}/result/decline`, { draftedAt: 43 }],
    ])
    expect(shownDebate.get()).toEqual(ROOM)
  })

  it('reads the room again when the result changed since the person read it', async () => {
    answers.push({ status: 409, body: { error: { code: 'conflict', message: 'The result changed.' } } })
    const exit = await run(approveResult(ID, 42))
    expect(exit._tag).toBe('Err')
    expect(sent.map((one) => one.path)).toEqual([
      `/api/v1/debates/${ID}/result/approval`,
      `/api/v1/debates/${ID}`,
    ])
    expect(shownDebate.get()).toEqual(ROOM)
  })

  it('does not read the room again for another refusal', async () => {
    answers.push({ status: 403, body: { error: { code: 'forbidden', message: 'No.' } } })
    await run(declineResult(ID, 42))
    expect(sent).toHaveLength(1)
  })

  it('opens a room and reloads the list, opts an agent in, posts the result and exports', async () => {
    answers.push({ status: 200, body: ROOM }, { status: 200, body: { debates: [] } })
    const wish = { question: 'Ship?', visibility: 'open' as const, limits: ROOM.limits, memberIds: [] }
    await run(createDebate(wish))
    await run(optInAgent(ID, CredentialId.of('agent0000000')))
    answers.push({ status: 500, body: { error: { code: 'unavailable', message: 'down' } } })
    await run(postResult(ID, { channel: 'billing' }))
    answers.push({
      status: 200,
      body: { filename: 'debate.md', mediaType: 'text/markdown', text: '# Debate' },
    })
    const exported = await run(exportDebate(ID, 'markdown'))
    expect(exported).toMatchObject({ _tag: 'Ok', value: { filename: 'debate.md' } })
    expect(sent.map((one) => [one.method, one.path, one.body])).toEqual([
      ['POST', '/api/v1/debates', wish],
      ['GET', '/api/v1/debates', undefined],
      ['PUT', `/api/v1/debates/${ID}/agent`, { agentId: 'cred_agent0000000' }],
      ['POST', `/api/v1/debates/${ID}/result/post`, { channel: 'billing' }],
      ['POST', `/api/v1/debates/${ID}/export`, { format: 'markdown' }],
    ])
  })
})
