import { Task as T } from '@homingbird/kernel'
import type { AsRead, ConversationId, NoteId } from '@homingbird/protocol'
import { type Action, withApp } from '../app.ts'
import { featureOn } from '../features.ts'

/**
 * Earlier answers to a question while it is being written, once the person pauses typing. A question
 * typed on, a feature switched off or a failed lookup finds nothing: sending never waits on this.
 */
export const findEarlierAnswers = (
  question: string,
  conversationId: ConversationId,
  isStillAsked: () => boolean,
): Action<ReadonlyArray<AsRead.EarlierAnswer>> =>
  withApp(({ api, state }) =>
    T.gen(function* () {
      yield* T.sleep(EARLIER_ANSWERS_PAUSE_MS)
      if (!isStillAsked() || !featureOn('earlierAnswers', state.serverInfo.get())) return NONE
      return yield* T.fold(
        () => NONE,
        (found: { readonly answers: ReadonlyArray<AsRead.EarlierAnswer> }) => found.answers,
      )(api['answers.earlier']({ body: { question, conversationId } }))
    }),
  )

/** Counts that an earlier answer answered the question the person was writing here; nothing is sent. */
export const markAnsweredFromHistory = (answerId: NoteId, conversationId: ConversationId): Action =>
  withApp(({ api }) => T.asUnit(api['answers.used']({ params: { id: answerId }, body: { conversationId } })))

export const EARLIER_ANSWERS_PAUSE_MS = 600

const NONE: ReadonlyArray<AsRead.EarlierAnswer> = []
