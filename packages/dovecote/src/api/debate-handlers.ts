import { Task as T } from '@homingbird/kernel'
import { type Contract, DebateId, type ResponseOf } from '@homingbird/protocol'
import { survivingPass } from '../background-pass.ts'
import { draftResult, exportDebate, postResult, voteForDraft } from '../domain/debate-results.ts'
import { seenBy } from '../domain/debate-rows.ts'
import { settleDebate, takeTurn, undecidedDebates } from '../domain/debate-turns.ts'
import {
  createDebate,
  debateAsks,
  debateFor,
  listDebates,
  optInAgent,
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
        asks: asks.map((ask) => ({ ...ask, debate: seenBy(caller)(ask.debate) })),
        ballots: ballots.map(seenBy(caller)),
        ended,
      }
    }),
  'debates.get': ({ params }, caller) =>
    T.flatMap((id: DebateId) => T.map(seenBy(caller))(debateFor(viewerOf(caller), id)))(
      identifier(DebateId, params.id),
    ),
  'debates.create': ({ body }, caller) => T.map(seenBy(caller))(createDebate(caller, body)),
  'debates.optIn': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => T.map(seenBy(caller))(optInAgent(caller, id, body.agentId)))(
      identifier(DebateId, params.id),
    ),
  'debates.limits.set': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => T.map(seenBy(caller))(setDebateLimits(caller, id, body)))(
      identifier(DebateId, params.id),
    ),
  'debates.turns.post': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => T.map(seenBy(caller))(takeTurn(caller, id, body)))(
      identifier(DebateId, params.id),
    ),
  'debates.result.draft': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => T.map(seenBy(caller))(draftResult(caller, id, body)))(
      identifier(DebateId, params.id),
    ),
  'debates.result.vote': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => T.map(seenBy(caller))(voteForDraft(caller, id, body)))(
      identifier(DebateId, params.id),
    ),
  'debates.result.post': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => postResult(caller, id, body))(identifier(DebateId, params.id)),
  'debates.export': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => exportDebate(caller, id, body.format, body.language))(
      identifier(DebateId, params.id),
    ),
} satisfies Partial<Handlers>
