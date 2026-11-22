import { type AsRead, DEBATE_QUESTION_MAX, DEFAULT_DEBATE_LIMITS, type MemberId } from '@homingbird/protocol'
import { type Lifetime, h, region } from '@homingbird/ui'
import {
  type DebateListModel,
  type ShownLimits,
  debateListModel,
  inviteesFor,
  limitFieldsModel,
  typedLimits,
} from '../models/debates.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { emptyWithPip, field, loading, page, privateMarkOf, timeLabel } from './parts.ts'

/** Debate rooms: the rooms the person may see, and a way to open one for a question. */
export const debatesView = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, actions } = context
  actions.loadDebates()
  return page(
    strings.debates.title,
    h('div', { class: 'debates-intro' }, h('p', {}, strings.debates.intro), newDebateButton(context, me)),
    region(life, [state.debates, state.debatesLoaded, state.directory], () =>
      renderDebateList(
        debateListModel({
          debates: state.debates.get(),
          loaded: state.debatesLoaded.get(),
          directory: state.directory.get(),
          now: context.clock.now(),
        }),
      ),
    ),
  )
}

/** The four limits as number fields and the grace as a choice, filled with the given values. */
export const limitFields = (limits: ShownLimits): HTMLElement => {
  const model = limitFieldsModel(limits)
  return h(
    'fieldset',
    { class: 'debate-limits' },
    h('legend', {}, strings.debates.limits),
    ...model.numbers.map((number) =>
      field(
        number.label,
        h('input', {
          type: 'number',
          name: number.name,
          inputmode: 'numeric',
          min: String(number.min),
          max: String(number.max),
          value: number.value === null ? '' : String(number.value),
          required: number.required,
        }),
      ),
    ),
    ...model.hints.map((hint) => h('small', { class: 'hint' }, hint)),
    field(
      strings.debates.graceMinutes,
      h(
        'select',
        { name: 'graceMinutes' },
        ...model.grace.map((choice) =>
          h('option', { value: String(choice.value), selected: choice.selected }, choice.label),
        ),
      ),
    ),
    h('small', { class: 'hint' }, strings.debates.graceHint),
  )
}

/** The limits typed into `limitFields`, or the reason they cannot be used. */
export const limitsTypedIn = (form: HTMLFormElement) =>
  typedLimits(
    (name) =>
      form.querySelector<HTMLInputElement | HTMLSelectElement>(
        name === 'graceMinutes' ? 'select[name="graceMinutes"]' : `input[name="${name}"]`,
      )?.value ?? '',
  )

const createForm = (context: ViewContext, me: AsRead.Me): HTMLElement => {
  const { state, actions } = context
  const question = h('textarea', {
    name: 'question',
    rows: '3',
    required: true,
    maxlength: String(DEBATE_QUESTION_MAX),
    placeholder: strings.debates.questionPlaceholder,
  })
  const colleagues = inviteesFor(state.directory.get(), me.member.id)
  const form = h(
    'form',
    {
      class: 'dialog-body create-debate',
      on: {
        submit: (event) => {
          event.preventDefault()
          const typed = limitsTypedIn(form)
          if ('problem' in typed) return state.notice.set({ kind: 'error', text: typed.problem })
          const chosen = form.querySelector<HTMLInputElement>('input[name="visibility"]:checked')?.value
          const invited = [...form.querySelectorAll<HTMLInputElement>('input[name="invite"]:checked')].map(
            (box) => box.value as MemberId,
          )
          actions.createDebate(
            {
              question: question.value.trim(),
              visibility: chosen === 'private' ? 'private' : 'open',
              limits: typed.limits,
              memberIds: invited,
            },
            {
              done: (created) => {
                closeDialog(context)
                context.page.go(hrefFor({ name: 'debate', id: created.id, tab: null }))
              },
            },
          )
        },
      },
    },
    field(strings.debates.question, question),
    h(
      'fieldset',
      { class: 'visibility-choice' },
      h('legend', {}, strings.debates.visibility),
      h(
        'label',
        {},
        h('input', { type: 'radio', name: 'visibility', value: 'open', checked: true }),
        h('span', {}, strings.debates.visibilityOpen),
      ),
      h(
        'label',
        {},
        h('input', { type: 'radio', name: 'visibility', value: 'private' }),
        h(
          'span',
          { class: 'private-choice' },
          h('span', { class: 'lock-mark', 'aria-hidden': 'true' }),
          strings.debates.visibilityPrivate,
        ),
      ),
    ),
    colleagues.length > 0 &&
      h(
        'fieldset',
        { class: 'debate-invite' },
        h('legend', {}, strings.debates.invite),
        h('small', {}, strings.debates.inviteHint),
        h(
          'div',
          { class: 'debate-invitees' },
          colleagues.map((colleague) =>
            h(
              'label',
              {},
              h('input', { type: 'checkbox', name: 'invite', value: colleague.value }),
              h('span', {}, colleague.label),
            ),
          ),
        ),
      ),
    h(
      'details',
      { class: 'debate-default-limits' },
      h('summary', {}, strings.debates.limitsDefaults),
      limitFields(DEFAULT_DEBATE_LIMITS),
    ),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      h('button', { type: 'submit', class: 'primary' }, strings.debates.create),
    ),
  )
  return form
}

const renderDebateList = (model: DebateListModel): HTMLElement => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'empty') return emptyWithPip('searching', model.text)
  return h(
    'ul',
    { class: 'debate-list' },
    model.rooms.map((room) =>
      h(
        'li',
        { class: room.className, data: { debate: room.id } },
        h('h2', { class: 'debate-question' }, h('a', { href: room.href }, room.question)),
        h(
          'p',
          { class: 'debate-meta' },
          h('span', { class: 'debate-stage' }, room.stage),
          room.isPrivate && privateMarkOf(strings.debates.private),
          room.counts.map((count) => h('span', {}, count)),
          timeLabel(room.time),
        ),
      ),
    ),
  )
}

const newDebateButton = (context: ViewContext, me: AsRead.Me): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: 'primary new-debate',
      ...opensDialog(context, strings.debates.newRoom, () => createForm(context, me)),
    },
    strings.debates.newRoom,
  )
