import { Schema as S, Task as T } from '@homingbird/kernel'
import {
  DEBATE_SUGGESTION_ADVICE,
  DebateQuestion,
  MemberId,
  NoteId,
  SUGGESTED_MEMBERS_MAX,
  SUGGESTION_REASON_MAX,
} from '@homingbird/protocol'
import type { Tool } from './tools.ts'

/**
 * The one tool that proposes a short debate before an answer. It saves a suggestion for the agent's person
 * to decide on in the web client and opens no flock, opts no agent in and sends nothing (rules 3 and 9).
 */
export const SUGGESTION_TOOLS: ReadonlyArray<Tool<any>> = [
  tool({
    name: 'suggest_debate',
    title: 'Suggest a short debate before answering',
    description: `Suggests to your human that you first talk a note over briefly with colleagues’ agents, before you answer it. ${DEBATE_SUGGESTION_ADVICE} It opens no flock and sends no note: your human sees your suggestion as a card in Homingbird and opens the flock or answers alone. When a flock it opened has ended, check_debates tells you to answer the note.`,
    readOnly: false,
    input: {
      inReplyTo: NoteId,
      question: DebateQuestion,
      memberIds: S.array(MemberId, { minItems: 1, maxItems: SUGGESTED_MEMBERS_MAX }),
      reason: S.string({ minLength: 1, maxLength: SUGGESTION_REASON_MAX }),
      draftId: S.optional(NoteId),
    },
    describe: {
      inReplyTo: 'The note you were going to answer.',
      question:
        'What you want to ask the colleagues’ agents, as a self-contained question for the flock, without private details of your human’s.',
      memberIds: `The colleagues whose agents you want in the flock, by memberId from find_people, at most ${SUGGESTED_MEMBERS_MAX}.`,
      reason: `One or two sentences for your human on why talking first helps, at most ${SUGGESTION_REASON_MAX} characters.`,
      draftId: 'A draft you already saved for this note, from draft_reply, that the card then belongs to.',
    },
    run: (suggestion, context) =>
      T.map(
        () =>
          'Your suggestion is saved. Your human decides in Homingbird whether the flock opens; nothing is sent and no flock is open yet. Go on with the rest of your work: check_debates tells you when a flock it opened has ended and the note waits for your answer.',
      )(context.api['debateSuggestions.create']({ body: suggestion })),
  }),
]

export const SUGGESTION_TOOL_NAMES: ReadonlyArray<string> = SUGGESTION_TOOLS.map((tool) => tool.name)

function tool<F extends S.Fields>(definition: Tool<F>): Tool<F> {
  return definition
}
