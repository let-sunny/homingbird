import type { AsRead, ConversationId } from '@homingbird/protocol'
import { type Lifetime, type ReadableSignal, h, region, signal, slice } from '@homingbird/ui'
import {
  type AnsweredBeforeModel,
  type OpenQuestion,
  answeredBeforeModel,
  openQuestionsLike,
  questionToLookUp,
} from '../models/answered-before.ts'
import type { ViewContext } from './context.ts'
import { button, timeLabel } from './parts.ts'

/**
 * Earlier answers to the question being typed, looked up once the person pauses. Saying one answers
 * it clears the composer and sends nothing; Send stays where it is either way.
 */
export const answeredBefore = (
  context: ViewContext,
  life: Lifetime,
  id: ConversationId,
  composer: {
    readonly typed: ReadableSignal<string>
    readonly isReplying: () => boolean
    readonly clear: () => void
  },
): HTMLElement => {
  const found = signal<ReadonlyArray<AsRead.EarlierAnswer>>([])
  const dismissed = signal(false)
  const answered = signal(false)
  let asked: string | null = null
  const lookUp = (): void => {
    const question = questionToLookUp(composer.typed.get(), composer.isReplying())
    if (composer.typed.get().trim() !== '') answered.set(false)
    if (question === null) dismissed.set(false)
    if (question === asked) return
    asked = question
    if (question === null) {
      found.set([])
      return
    }
    const isStillAsked = (): boolean => asked === question
    context.actions.findEarlierAnswers(question, id, isStillAsked, {
      done: (answers) => {
        if (isStillAsked()) found.set(answers)
      },
    })
  }
  life.add(composer.typed.subscribe(lookUp))
  const useAnswer = (answerId: AsRead.EarlierAnswer['answer']['id']): void => {
    context.actions.markAnsweredFromHistory(answerId, id)
    composer.clear()
    found.set([])
    answered.set(true)
  }
  const open = slice(
    [composer.typed, context.state.threads, context.state.reviews, context.state.conversations],
    () => openHere(context, id, composer.isReplying() ? '' : composer.typed.get()),
  )
  return region(
    life,
    [found, open, dismissed, answered, context.state.members],
    () =>
      renderAnsweredBefore(
        answeredBeforeModel({
          found: found.get(),
          open: open.get(),
          dismissed: dismissed.get(),
          answered: answered.get(),
          members: context.state.members.get(),
          now: context.clock.now(),
        }),
        { use: useAnswer, keepWriting: () => dismissed.set(true) },
      ),
    { class: 'answered-before-region' },
  )
}

/** The open questions like the one being typed, in a channel's room only: elsewhere a question waits for one person. */
const openHere = (context: ViewContext, id: ConversationId, typed: string): ReadonlyArray<OpenQuestion> => {
  const room = context.state.conversations.get().find((conversation) => conversation.id === id)
  if (room?.kind !== 'channel') return []
  return openQuestionsLike(
    typed,
    context.state.threads.get().get(id)?.notes ?? [],
    context.state.reviews.get(),
  )
}

const renderAnsweredBefore = (
  model: AnsweredBeforeModel,
  on: {
    readonly use: (answerId: AsRead.EarlierAnswer['answer']['id']) => void
    readonly keepWriting: () => void
  },
): HTMLElement | null => {
  if (model.kind === 'none') return null
  if (model.kind === 'answered') return h('p', { class: 'answered-before-done', role: 'status' }, model.text)
  return h(
    'section',
    { class: 'answered-before', 'aria-label': model.title },
    h(
      'header',
      { class: 'answered-before-head' },
      h('strong', {}, model.title),
      h('span', {}, model.lead),
      button(model.keepWriting, on.keepWriting, { class: 'link' }),
    ),
    h(
      'ul',
      { class: 'answered-before-list' },
      model.items.map((item) =>
        h(
          'li',
          { class: 'answered-before-item', data: { answerId: item.answerId } },
          h('p', { class: 'answered-before-question' }, item.question),
          h('p', { class: 'answered-before-answer note-body' }, item.answer),
          h(
            'p',
            { class: 'answered-before-meta' },
            h('span', {}, item.approvedBy),
            item.place !== null && h('span', {}, item.place),
            timeLabel(item.time),
            h('a', { href: item.href }, item.open),
          ),
          button(item.thisAnswersIt, () => on.use(item.answerId)),
        ),
      ),
      model.asked.map((item) =>
        h(
          'li',
          { class: 'answered-before-item is-open', data: { questionId: item.questionId } },
          h('p', { class: 'answered-before-question' }, item.question),
          h(
            'p',
            { class: 'answered-before-meta' },
            h('span', {}, item.asked),
            item.review !== null && h('strong', {}, item.review),
            h('a', { href: item.href }, item.open),
          ),
        ),
      ),
    ),
  )
}
