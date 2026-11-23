import { Task as T } from '@homingbird/kernel'
import {
  type Debate,
  type DebateId,
  type DebateSuggestion,
  Invalid,
  MemberId,
  NoteId,
  SHORT_DEBATE_LIMITS,
  type SuggestionId,
  limitsFor,
} from '@homingbird/protocol'
import { changeRoom, colleagueJoinsLater, roomById } from './debate-script.ts'
import { type Handlers, found } from './handlers.ts'
import { connectedAgentOf, memberById } from './reads.ts'
import { saveDraft } from './sending.ts'
import type { World } from './world.ts'

/**
 * The one suggestion the demo's agent makes: before answering Kai's question about the deploy window it
 * proposes a short flock with Ana's agent. The visitor opens it, and a scripted short debate follows, or
 * says "just answer" and the agent drafts its reply to Kai.
 */
export const suggestionHandlers = (world: World): Handlers => {
  let waiting = [suggestedFirst(world)]
  const waitingOf = (id: string) =>
    found(
      waiting.find((each) => each.suggestion.id === id),
      NO_SUGGESTION,
    )
  const dropped = (id: string): void => {
    waiting = waiting.filter((each) => each.suggestion.id !== id)
  }
  return {
    'debateSuggestions.list': () => T.sync(() => ({ suggestions: waiting.map((each) => each.suggestion) })),
    'debateSuggestions.accept': ({ params, body }, viewerId) =>
      T.gen(function* () {
        const { suggestion } = yield* waitingOf(params.id)
        const agent = connectedAgentOf(world.records(), viewerId, null)
        const question = (body.question ?? suggestion.question).trim()
        if (question === '') return yield* T.fail(Invalid({ message: 'A flock needs a question.' }))
        const invited = (body.memberIds ?? suggestion.memberIds).filter(
          (id) => id !== viewerId && memberById(world.records(), id)?.kind === 'person',
        )
        const brief = body.brief?.trim() ?? ''
        const now = world.clock.now()
        const debate: Debate = {
          id: world.nextId('deb') as DebateId,
          fromSuggestion: true,
          question,
          visibility: 'private',
          status: 'open',
          createdBy: viewerId,
          createdAt: now,
          deadlineAt: now + SHORT_DEBATE_LIMITS.minutes * 60_000,
          concludedAt: null,
          closedAt: null,
          endedBecause: null,
          limits: limitsFor(SHORT_DEBATE_LIMITS, 2),
          memberIds: [viewerId, ...invited],
          participants: [
            {
              memberId: viewerId,
              agentId: agent!.id,
              agentName: agent!.name,
              joinedAt: now,
              takingPart: true,
            },
          ],
          turns: [],
          result: null,
          resultRound: 0,
          brief: brief === '' ? null : brief,
        }
        world.update((records) => ({ ...records, debates: [debate, ...records.debates] }))
        changeRoom(world, debate.id, (room) => room)
        colleagueJoinsLater(world, debate.id, invited[0] ?? null)
        dropped(params.id)
        return roomById(world, debate.id)!
      }),
    'debateSuggestions.dismiss': ({ params }, viewerId) =>
      T.gen(function* () {
        const { suggestion, answer } = yield* waitingOf(params.id)
        dropped(params.id)
        world.after(JUST_ANSWER_AFTER_MS, () =>
          saveDraft(world, {
            conversationId: suggestion.conversationId,
            authorId: viewerId,
            body: answer,
            inReplyTo: suggestion.inReplyTo,
            agentName: suggestion.agentName,
            basis: "Tuesday's migration plan and last night's export log.",
          }),
        )
        return {}
      }),
  }
}

/** How long the agent takes to draft its answer once the visitor said to just answer. */
export const JUST_ANSWER_AFTER_MS = 4_000

const suggestedFirst = (world: World): Waiting => {
  const question = world.records().notes.find((note) => note.id === ASKED_NOTE)!
  return {
    suggestion: {
      id: 'sugg_demodeploywindow' as SuggestionId,
      inReplyTo: question.id,
      conversationId: question.conversationId,
      draftId: null,
      question: 'Can the billing migration still run with the deploy window moved to 16:00?',
      memberIds: [ANA],
      reason:
        'Kai asks about a clash, and the answer turns on how long the migration runs and what the release freeze leaves. Ana’s agent knows the plan; a short talk first saves a wrong answer.',
      agentName: "June's laptop",
      createdAt: world.clock.now() - 20 * 60_000,
      askerId: question.authorId,
    },
    answer:
      'No clash. The migration finishes by 02:30, well before a 16:00 deploy window, and it can pause between batches if the window moves again.',
  }
}

interface Waiting {
  readonly suggestion: DebateSuggestion
  /** What the agent drafts for the asker when the visitor says to just answer. */
  readonly answer: string
}

const ASKED_NOTE = NoteId.of('demokai00001')
const ANA = MemberId.of('demoana00000')
const NO_SUGGESTION = 'No such suggestion.'
