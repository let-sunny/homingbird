import { Result } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DebateResult } from '../src/debate-result.ts'
import { DEBATE_PARTICIPANTS_MAX } from '../src/debate-result.ts'
import {
  type DebateActionEffect,
  type DebateEvent,
  type DebateRoom,
  type DebateSettlingEffect,
  askOf,
  askedTurnOf,
  settleDebateRoom,
  stepDebate,
} from '../src/debate-room.ts'
import { isReadyToConclude, isTakingPart, limitsProblem } from '../src/debate-rules.ts'
import type { Conflict, Invalid } from '../src/errors.ts'
import { MemberId } from '../src/ids.ts'

const MEMBERS = [
  MemberId.of('ana000000000'),
  MemberId.of('ben000000000'),
  MemberId.of('cy0000000000'),
  MemberId.of('dan000000000'),
] as const

const STAGE_RANK = { setup: 0, open: 1, drafting: 2, voting: 3, approving: 4, closed: 5, ended: 5 } as const
const SETTLING_FOR_STAGE = {
  drafting: 'conclude',
  voting: 'openVote',
  closed: 'close',
  ended: 'end',
} as const

type Step =
  | { readonly op: 'wait'; readonly ms: number }
  | { readonly op: 'tick' }
  | { readonly op: 'presence'; readonly memberId: MemberId; readonly takingPart: boolean }
  | { readonly op: 'join'; readonly memberId: MemberId }
  | { readonly op: 'setLimits'; readonly minutes: number; readonly turnsPerAgent: number }
  | { readonly op: 'turn'; readonly memberId: MemberId; readonly ready: boolean; readonly body: BodyKind }
  | { readonly op: 'askedTurn'; readonly ready: boolean }
  | {
      readonly op: 'draft'
      readonly memberId: MemberId
      readonly result: DebateResult
      readonly fits: boolean
    }
  | { readonly op: 'vote'; readonly memberId: MemberId; readonly draftBy: MemberId; readonly round: 0 | 1 }

type BodyKind = 'text' | 'blank' | 'tooLong'

type Outcome =
  | {
      readonly accepted: true
      readonly action: DebateActionEffect
      readonly effects: ReadonlyArray<DebateSettlingEffect>
    }
  | { readonly accepted: false; readonly error: Conflict | Invalid }

interface Transition {
  readonly before: DebateRoom
  readonly snapshot: DebateRoom
  readonly after: DebateRoom
  readonly now: number
  readonly event: DebateEvent | null
  readonly outcome: Outcome | null
  readonly effects: ReadonlyArray<DebateSettlingEffect>
}

const member = fc.constantFrom(...MEMBERS)
const smallLimits = fc
  .record({
    turnsPerAgent: fc.integer({ min: 1, max: 3 }),
    totalTurns: fc.integer({ min: 2, max: 6 }),
    minutes: fc.integer({ min: 5, max: 30 }),
    turnCharacters: fc.constant(200),
  })
  .filter((limits) => limitsProblem(limits) === null)
const wait = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 60_000 }), weight: 6 },
  { arbitrary: fc.constantFrom(3 * 60_000, 5 * 60_000, 30 * 60_000, 24 * 60 * 60_000), weight: 1 },
)
const step: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: wait.map((ms) => ({ op: 'wait' as const, ms })), weight: 3 },
  { arbitrary: fc.constant({ op: 'tick' as const }), weight: 2 },
  {
    arbitrary: fc.record({
      op: fc.constant('presence' as const),
      memberId: member,
      takingPart: fc.boolean(),
    }),
    weight: 1,
  },
  { arbitrary: member.map((memberId) => ({ op: 'join' as const, memberId })), weight: 2 },
  {
    arbitrary: fc.record({
      op: fc.constant('setLimits' as const),
      minutes: fc.integer({ min: 5, max: 30 }),
      turnsPerAgent: fc.integer({ min: 1, max: 3 }),
    }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      op: fc.constant('turn' as const),
      memberId: member,
      ready: fc.boolean(),
      body: fc.constantFrom<BodyKind>('text', 'text', 'text', 'blank', 'tooLong'),
    }),
    weight: 3,
  },
  { arbitrary: fc.boolean().map((ready) => ({ op: 'askedTurn' as const, ready })), weight: 6 },
  {
    arbitrary: fc.record({
      op: fc.constant('draft' as const),
      memberId: member,
      result: arbitrary(DebateResult),
      fits: fc.boolean(),
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      op: fc.constant('vote' as const),
      memberId: member,
      draftBy: member,
      round: fc.constantFrom(0 as const, 1 as const),
    }),
    weight: 3,
  },
)
const script = fc.record({
  limits: smallLimits,
  joined: fc.subarray([...MEMBERS], { minLength: 0 }),
  steps: fc.array(step, { minLength: 30, maxLength: 80 }),
})
type Script = typeof script extends fc.Arbitrary<infer S> ? S : never

const BODIES: Record<BodyKind, string> = { text: 'A point.', blank: '   ', tooLong: 'x'.repeat(201) }

const fitting = (result: DebateResult, room: DebateRoom): DebateResult => ({
  ...result,
  contributions: room.participants.map((one) => ({ memberId: one.memberId, summary: 'Spoke.', credits: [] })),
  nextSteps: [],
})

const eventOf = (step: Step, room: DebateRoom, now: number): DebateEvent | null => {
  switch (step.op) {
    case 'turn':
      return { type: 'turn', memberId: step.memberId, body: BODIES[step.body], ready: step.ready }
    case 'askedTurn': {
      const asked = askedTurnOf(settleDebateRoom(room, now).room, now)
      return asked === null
        ? null
        : { type: 'turn', memberId: asked.memberId, body: BODIES.text, ready: step.ready }
    }
    case 'join':
      return { type: 'join', memberId: step.memberId }
    case 'setLimits':
      return {
        type: 'setLimits',
        limits: { turnsPerAgent: step.turnsPerAgent, minutes: step.minutes, turnCharacters: 200 },
      }
    case 'draft':
      return {
        type: 'draft',
        memberId: step.memberId,
        result: step.fits ? fitting(step.result, room) : step.result,
      }
    case 'vote':
      return { type: 'vote', memberId: step.memberId, vote: { round: step.round, draftBy: step.draftBy } }
    default:
      return null
  }
}

const run = ({ limits, joined, steps }: Script): Transition[] => {
  let room: DebateRoom = {
    stage: { stage: 'setup' },
    createdAt: 0,
    askingSince: 0,
    deadlineAt: limits.minutes * 60_000,
    limits,
    participants: joined.map((memberId) => ({ memberId })),
    turns: [],
    round: 0,
    drafts: [],
    votes: [],
  }
  let now = 0
  const trace: Transition[] = []
  for (const one of steps) {
    if (one.op === 'wait') {
      now += one.ms
    } else if (one.op === 'presence') {
      room = {
        ...room,
        participants: room.participants.map((participant) =>
          participant.memberId === one.memberId
            ? { ...participant, takingPart: one.takingPart }
            : participant,
        ),
      }
    } else if (one.op === 'tick') {
      const settled = settleDebateRoom(room, now)
      trace.push({
        before: room,
        snapshot: structuredClone(room),
        after: settled.room,
        now,
        event: null,
        outcome: null,
        effects: settled.effects,
      })
      room = settled.room
    } else {
      const event = eventOf(one, room, now)
      if (event === null) continue
      const snapshot = structuredClone(room)
      const move = stepDebate(room, event, now)
      if (Result.isOk(move)) {
        const effects = [...move.value.before, ...move.value.after]
        trace.push({
          before: room,
          snapshot,
          after: move.value.room,
          now,
          event,
          outcome: { accepted: true, action: move.value.action, effects },
          effects,
        })
        room = move.value.room
      } else {
        trace.push({
          before: room,
          snapshot,
          after: room,
          now,
          event,
          outcome: { accepted: false, error: move.error },
          effects: [],
        })
      }
    }
  }
  return trace
}

const lawful = (law: (transition: Transition) => void, numRuns = 200) =>
  fc.assert(
    fc.property(script, (generated) => {
      for (const transition of run(generated)) law(transition)
    }),
    { numRuns },
  )

const everyAgentIsReady = (room: DebateRoom): boolean =>
  room.turns.length > 0 &&
  room.participants.filter(isTakingPart).every((one) => isReadyToConclude(room, one.memberId))

describe('the flock machine, as a model over any run of events', () => {
  it('reaches every stage a run can reach, and refuses as well as accepts, so the laws are tried on each', () => {
    const traces = fc.sample(script, { numRuns: 300, seed: 7 }).flatMap(run)
    expect([...new Set(traces.map(({ after }) => after.stage.stage))].sort()).toEqual([
      'closed',
      'drafting',
      'ended',
      'open',
      'setup',
      'voting',
    ])
    const outcomes = new Set(
      traces.map(({ outcome }) => outcome && (outcome.accepted ? 'ok' : outcome.error._tag)),
    )
    expect([...outcomes].sort()).toEqual(['Conflict', 'Invalid', 'ok', null].sort())
  })

  it('only moves a flock forward through its phases, and never leaves closed or ended', () => {
    lawful(({ before, after }) => {
      expect(STAGE_RANK[after.stage.stage]).toBeGreaterThanOrEqual(STAGE_RANK[before.stage.stage])
      if (before.stage.stage === 'closed' || before.stage.stage === 'ended')
        expect(after.stage).toEqual(before.stage)
      expect(after.stage.stage).not.toBe('approving')
    })
  })

  it('names each phase it moves into with the matching settling effect, and none when it stays', () => {
    lawful(({ before, after, effects }) => {
      const kinds = effects.map((effect) => effect.type)
      if (after.stage.stage === before.stage.stage) {
        expect(kinds.filter((kind) => kind !== 'openVote' && kind !== 'conclude')).toEqual([])
        return
      }
      const wanted = SETTLING_FOR_STAGE[after.stage.stage as keyof typeof SETTLING_FOR_STAGE]
      expect(kinds.at(-1)).toBe(wanted)
      expect(effects.filter((effect) => effect.type === 'close' || effect.type === 'end').length).toBe(
        wanted === 'close' || wanted === 'end' ? 1 : 0,
      )
    })
  })

  it('keeps a flock in setup only while no turn is taken, and in open only once one is', () => {
    lawful(({ after }) => {
      if (after.stage.stage === 'setup') expect(after.turns).toEqual([])
      if (after.stage.stage === 'open') expect(after.turns.length).toBeGreaterThan(0)
    })
  })

  it('leaves the flock it was given untouched, and the flock unchanged, when it refuses an event', () => {
    lawful(({ before, snapshot, after, now, event, outcome }) => {
      expect(before).toEqual(snapshot)
      if (outcome === null || outcome.accepted) return
      expect(after).toBe(before)
      expect(['Conflict', 'Invalid']).toContain(outcome.error._tag)
      const again = stepDebate(before, event!, now)
      expect(Result.isOk(again)).toBe(false)
      if (!Result.isOk(again)) expect(again.error).toEqual(outcome.error)
    })
  })

  it('refuses every event a closed or ended flock is given', () => {
    lawful(({ before, outcome }) => {
      if (outcome === null) return
      if (before.stage.stage === 'closed' || before.stage.stage === 'ended')
        expect(outcome.accepted).toBe(false)
    })
  })

  it('never refuses time: settling a flock takes no error, changes only its stage, and settles once', () => {
    lawful(({ before, now }) => {
      const settled = settleDebateRoom(before, now)
      expect({ ...settled.room, stage: before.stage }).toEqual({ ...before, stage: before.stage })
      const again = settleDebateRoom(settled.room, now)
      expect(again.effects).toEqual([])
      expect(again.room).toBe(settled.room)
    })
  })

  it('holds the turn for at most one agent, the one the flock names, and for none once turns stop', () => {
    lawful(({ after, now }) => {
      const asking = after.participants.filter((one) => askOf(after, one.memberId, now) === 'turn')
      expect(asking.length).toBeLessThanOrEqual(1)
      const named = askedTurnOf(after, now)
      if (asking.length === 1) expect(asking[0]!.memberId).toBe(named?.memberId)
      if (after.stage.stage !== 'setup' && after.stage.stage !== 'open') {
        expect(asking).toEqual([])
        expect(named).toBeNull()
      }
    })
  })

  it('takes a turn only from the agent asked, never twice in a row, within its share and the total', () => {
    lawful(({ before, after, now, event, outcome }) => {
      if (outcome?.accepted === true && event?.type === 'turn') {
        expect(askedTurnOf(settleDebateRoom(before, now).room, now)?.memberId).toBe(event.memberId)
        expect(after.turns.at(-1)?.memberId).toBe(event.memberId)
        expect(event.body.trim()).not.toBe('')
        expect(event.body.length).toBeLessThanOrEqual(after.limits.turnCharacters)
      }
      expect(after.turns.length).toBeLessThanOrEqual(after.limits.totalTurns)
      for (const [index, turn] of after.turns.entries()) {
        if (index > 0) expect(turn.memberId).not.toBe(after.turns[index - 1]!.memberId)
        expect(after.turns.filter((other) => other.memberId === turn.memberId).length).toBeLessThanOrEqual(
          after.limits.turnsPerAgent,
        )
      }
    })
  })

  it('refuses a blank turn and one over the cap as invalid, and stale or unasked turns as a conflict', () => {
    lawful(({ before, now, event, outcome }) => {
      if (event?.type !== 'turn' || outcome === null || outcome.accepted) return
      const asked = askedTurnOf(settleDebateRoom(before, now).room, now)
      if (asked?.memberId !== event.memberId) expect(outcome.error._tag).toBe('Conflict')
      else if (event.body.trim() === '' || event.body.length > before.limits.turnCharacters)
        expect(outcome.error._tag).toBe('Invalid')
    })
  })

  it('stops early by agreement exactly when every agent taking part is ready, and never leaves such a flock open', () => {
    lawful(({ after, effects, now, outcome }) => {
      if (after.stage.stage === 'open' && (outcome === null || outcome.accepted))
        expect(everyAgentIsReady(after) && after.participants.length >= 2).toBe(false)
      for (const effect of effects) {
        if (effect.type !== 'conclude' || effect.because !== 'agreed') continue
        expect(everyAgentIsReady(after)).toBe(true)
        expect(after.turns.length).toBeLessThan(after.limits.totalTurns)
        expect(now).toBeLessThan(after.deadlineAt)
      }
    })
  })

  it('stops by agreement a flock whose agents all say ready, and keeps going while one dissents', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),
        fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
        (agents, readiness) => {
          const people = MEMBERS.slice(0, agents)
          let room: DebateRoom = {
            stage: { stage: 'setup' },
            createdAt: 0,
            askingSince: 0,
            deadlineAt: 60 * 60_000,
            limits: { turnsPerAgent: 3, totalTurns: 100, minutes: 60, turnCharacters: 200 },
            participants: people.map((memberId) => ({ memberId })),
            turns: [],
            round: 0,
            drafts: [],
            votes: [],
          }
          for (const ready of readiness) {
            const asked = askedTurnOf(room, 0)
            if (asked === null) break
            const move = stepDebate(
              room,
              { type: 'turn', memberId: asked.memberId, body: 'Point.', ready },
              0,
            )
            if (!Result.isOk(move)) throw new Error(move.error.message)
            room = move.value.room
            const latest = people.map(
              (one) =>
                room.turns.filter((turn) => turn.memberId === one).length >= 3 ||
                room.turns.findLast((turn) => turn.memberId === one)?.ready === true,
            )
            const all = latest.every(Boolean)
            expect(room.stage.stage === 'drafting').toBe(all || room.turns.length >= 3 * agents)
          }
        },
      ),
    )
  })

  it('keeps participants unique, in join order, at most the most a flock holds, and only ever adds to them', () => {
    lawful(({ before, after }) => {
      const ids = after.participants.map((one) => one.memberId)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids.length).toBeLessThanOrEqual(DEBATE_PARTICIPANTS_MAX)
      expect(ids.slice(0, before.participants.length)).toEqual(before.participants.map((one) => one.memberId))
    })
  })

  it('only appends to turns, drafts and votes, and never changes the round', () => {
    lawful(({ before, after }) => {
      expect(after.turns.slice(0, before.turns.length)).toEqual(before.turns)
      expect(after.drafts.slice(0, before.drafts.length)).toEqual(before.drafts)
      expect(after.votes.slice(0, before.votes.length)).toEqual(before.votes)
      expect(after.round).toBe(before.round)
      expect(after.turns.length - before.turns.length).toBeLessThanOrEqual(1)
    })
  })

  it('takes drafts only while drafting and votes only while voting, one of each per agent, never for itself', () => {
    lawful(({ before, after, now, event, outcome }) => {
      const drafters = after.drafts.map((draft) => draft.draftedBy)
      expect(new Set(drafters).size).toBe(drafters.length)
      const voters = after.votes.map((vote) => vote.voterId)
      expect(new Set(voters).size).toBe(voters.length)
      for (const vote of after.votes) {
        expect(vote.voterId).not.toBe(vote.draftBy)
        expect(drafters).toContain(vote.draftBy)
      }
      if (outcome?.accepted !== true) return
      const stage = settleDebateRoom(before, now).room.stage.stage
      if (event?.type === 'draft') expect(stage).toBe('drafting')
      if (event?.type === 'vote') expect(stage).toBe('voting')
    })
  })

  it('answers an accepted event with an action that says what it added', () => {
    lawful(({ before, after, event, outcome }) => {
      if (outcome?.accepted !== true || event === null) return
      const action = outcome.action
      if (action.type === 'addTurn') {
        expect(action.position).toBe(after.turns.length)
        expect(action.memberId).toBe(after.turns.at(-1)?.memberId)
        expect(action.ready).toBe(after.turns.at(-1)?.ready)
      }
      if (action.type === 'addParticipant') expect(after.participants.at(-1)?.memberId).toBe(action.memberId)
      if (action.type === 'changeLimits') {
        expect(after.limits).toEqual(action.limits)
        expect(after.deadlineAt).toBe(action.deadlineAt)
      }
      if (action.type === 'addDraft') expect(after.drafts.at(-1)?.draftedBy).toBe(action.memberId)
      if (action.type === 'addVote') expect(after.votes.at(-1)?.voterId).toBe(action.voterId)
      expect(
        {
          turn: 'addTurn',
          join: 'addParticipant',
          setLimits: 'changeLimits',
          draft: 'addDraft',
          vote: 'addVote',
        }[event.type],
      ).toBe(action.type)
      expect(before.participants.length + (action.type === 'addParticipant' ? 1 : 0)).toBe(
        after.participants.length,
      )
    })
  })

  it('moves the deadline only with new limits or the first turn, and the asking time only with a join or a turn', () => {
    lawful(({ before, after, now, event, outcome }) => {
      const accepted = outcome?.accepted === true ? event : null
      if (after.deadlineAt !== before.deadlineAt) {
        if (accepted?.type === 'setLimits')
          expect(after.deadlineAt).toBe(after.createdAt + after.limits.minutes * 60_000)
        else {
          expect(accepted?.type).toBe('turn')
          expect(before.turns).toEqual([])
          expect(after.deadlineAt).toBe(now + after.limits.minutes * 60_000)
        }
      }
      if (after.askingSince !== before.askingSince) {
        expect(['join', 'turn']).toContain(accepted?.type)
        if (accepted?.type === 'turn') expect(after.askingSince).toBe(now)
      }
      expect(
        after.limits === before.limits || accepted?.type === 'setLimits' || accepted?.type === 'join',
      ).toBe(true)
    })
  })

  it('closes only with a draft it holds, ends with a reason when fewer than two agents or turns remain, and never with a result then', () => {
    lawful(({ after, effects }) => {
      if (after.stage.stage === 'closed') expect(after.drafts).toContainEqual(after.stage.result)
      if (after.stage.stage === 'ended' && after.stage.because === 'too_few_agents')
        expect(after.participants.length).toBeLessThan(2)
      if (after.stage.stage === 'ended' && after.stage.because === 'no_turns') expect(after.turns).toEqual([])
      for (const effect of effects)
        if (effect.type === 'end' && effect.during === 'turns') expect(after.drafts).toEqual([])
    })
  })
})
