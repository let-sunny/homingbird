import { Task as T } from '@homingbird/kernel'
import { type Contract, type Debate, DebateId, type ResponseOf } from '@homingbird/protocol'
import { survivingPass } from '../background-pass.ts'
import { draftResult, exportDebate, postResult, voteForDraft } from '../domain/debate-results.ts'
import { shownTo } from '../domain/debate-rows.ts'
import { settleDebate, takeTurn, undecidedDebates } from '../domain/debate-turns.ts'
import {
  createDebate,
  debateAsks,
  debateFor,
  listDebates,
  optInAgent,
  setDebateBrief,
  setDebateLimits,
} from '../domain/debates.ts'
import { isHuman, viewerOf } from '../environment.ts'
import { transact } from '../events/events.ts'
import type { Handlers } from './handlers.ts'
import { identifier } from './route-parameters.ts'

/** Debate rooms: opening one, the agents' turns, and the result a person posts or exports. */
export const debateHandlers = {
  'debates.list': (_, caller) =>
    T.map((debates: Awaited<ResponseOf<Contract['debates.list']>>['debates']) => ({ debates }))(
      listDebates(viewerOf(caller)),
    ),
  'debates.waiting': (_, caller) =>
    T.gen(function* () {
      if (!isHuman(caller))
        for (const id of yield* undecidedDebates(caller.credential.id))
          yield* survivingPass(`debate room ${id}`, transact(settleDebate(id)))
      const { asks, ballots, ended } = yield* transact(debateAsks(caller))
      return {
        asks: yield* T.forEach(asks, (ask) =>
          T.map((debate: Debate) => ({ ...ask, debate }))(shownTo(caller)(ask.debate)),
        ),
        ballots: yield* T.forEach(ballots, (debate) => shownTo(caller)(debate)),
        ended,
      }
    }),
  'debates.get': ({ params }, caller) =>
    T.flatMap((id: DebateId) => T.flatMap(shownTo(caller))(debateFor(viewerOf(caller), id)))(
      identifier(DebateId, params.id),
    ),
  'debates.create': ({ body }, caller) => T.flatMap(shownTo(caller))(createDebate(caller, body)),
  'debates.optIn': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => T.flatMap(shownTo(caller))(optInAgent(caller, id, body.agentId, body.brief)))(
      identifier(DebateId, params.id),
    ),
  'debates.brief.set': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => T.flatMap(shownTo(caller))(setDebateBrief(caller, id, body.brief)))(
      identifier(DebateId, params.id),
    ),
  'debates.limits.set': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => T.flatMap(shownTo(caller))(setDebateLimits(caller, id, body)))(
      identifier(DebateId, params.id),
    ),
  'debates.turns.post': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => T.flatMap(shownTo(caller))(takeTurn(caller, id, body)))(
      identifier(DebateId, params.id),
    ),
  'debates.result.draft': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => T.flatMap(shownTo(caller))(draftResult(caller, id, body)))(
      identifier(DebateId, params.id),
    ),
  'debates.result.vote': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => T.flatMap(shownTo(caller))(voteForDraft(caller, id, body)))(
      identifier(DebateId, params.id),
    ),
  'debates.result.post': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => postResult(caller, id, body))(identifier(DebateId, params.id)),
  'debates.export': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => exportDebate(caller, id, body.format, body.language))(
      identifier(DebateId, params.id),
    ),
} satisfies Partial<Handlers>
