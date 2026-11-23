import { Task as T } from '@homingbird/kernel'
import {
  type Contract,
  type Debate,
  DebateId,
  type DebateSuggestion,
  type ResponseOf,
} from '@homingbird/protocol'
import { survivingPass } from '../background-pass.ts'
import { draftResult, exportDebate, postResult, voteForDraft } from '../domain/debate-results.ts'
import { shownTo } from '../domain/debate-rows.ts'
import {
  acceptSuggestion,
  dismissSuggestion,
  roomAnswerAsks,
  suggestDebate,
  waitingSuggestions,
} from '../domain/debate-suggestions.ts'
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
import { chooseFreeSlots, openSchedulingRoom, shareFreeSlots } from '../domain/scheduling-rooms.ts'
import { isHuman, viewerOf } from '../environment.ts'
import { transact } from '../events/events.ts'
import type { Handlers } from './handlers.ts'
import { identifier } from './route-parameters.ts'

/**
 * Debate rooms: opening one, the agents' turns, and the result a person posts or exports; scheduling
 * rooms, where agents and people give free times and the room settles the time itself; and the short
 * rooms an agent suggests before it answers, which only its person opens.
 */
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
      const { asks, upcoming, ballots, ended } = yield* transact(debateAsks(caller))
      const answers = yield* transact(roomAnswerAsks(caller))
      return {
        asks: yield* T.forEach(asks, (ask) =>
          T.map((debate: Debate) => ({ ...ask, debate }))(shownTo(caller)(ask.debate)),
        ),
        upcoming: yield* T.forEach(upcoming, (debate) => shownTo(caller)(debate)),
        ballots: yield* T.forEach(ballots, (debate) => shownTo(caller)(debate)),
        ended,
        ...(answers !== null && { answers }),
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
  'scheduling.create': ({ body }, caller) => T.flatMap(shownTo(caller))(openSchedulingRoom(caller, body)),
  'scheduling.slots.set': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => T.flatMap(shownTo(caller))(chooseFreeSlots(caller, id, body.slots)))(
      identifier(DebateId, params.id),
    ),
  'debates.slots.post': ({ params, body }, caller) =>
    T.flatMap((id: DebateId) => T.flatMap(shownTo(caller))(shareFreeSlots(caller, id, body)))(
      identifier(DebateId, params.id),
    ),
  'debateSuggestions.create': ({ body }, caller) => suggestDebate(caller, body),
  'debateSuggestions.list': (_, caller) =>
    T.map((suggestions: DebateSuggestion[]) => ({ suggestions }))(waitingSuggestions(caller)),
  'debateSuggestions.accept': ({ params, body }, caller) =>
    T.flatMap(shownTo(caller))(acceptSuggestion(caller, params.id, body)),
  'debateSuggestions.dismiss': ({ params }, caller) => T.as({})(dismissSuggestion(caller, params.id)),
} satisfies Partial<Handlers>
