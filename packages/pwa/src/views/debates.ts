import { type AsRead, DEBATE_QUESTION_MAX, DEFAULT_DEBATE_LIMITS, type MemberId } from '@homingbird/protocol'
import { type Lifetime, h, region, signal } from '@homingbird/ui'
import { featureOn } from '../features.ts'
import {
  type DebateListModel,
  type ShownLimits,
  debateListModel,
  limitFieldsModel,
  typedLimits,
} from '../models/debates.ts'
import { roomCandidates } from '../models/people-picker.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { emptyWithPip, field, loading, page, privateMarkOf, timeLabel } from './parts.ts'
import { peoplePicker } from './people-picker.ts'
import { schedulingForm } from './scheduling-form.ts'

/** Flocks: the flocks the person may see, and a way to open one for a question. */
export const debatesView = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, actions } = context
  actions.loadDebates()
  return page(
    strings.debates.title,
    h(
      'div',
      { class: 'debates-intro' },
      h('p', { class: 'hint' }, strings.debates.intro),
      newRoomButton(context, me),
    ),
    region(life, [state.debates, state.debatesLoaded, state.directory, state.serverInfo], () =>
      renderDebateList(
        debateListModel({
          debates: state.debates.get(),
          loaded: state.debatesLoaded.get(),
          directory: state.directory.get(),
          now: context.clock.now(),
          schedulingOn: featureOn('schedulingRooms', state.serverInfo.get()),
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

const debateCreateForm = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, actions } = context
  const question = h('textarea', {
    name: 'question',
    rows: '3',
    required: true,
    maxlength: String(DEBATE_QUESTION_MAX),
    placeholder: strings.debates.questionPlaceholder,
  })
  const invited = signal<ReadonlyArray<MemberId>>([])
  const colleagues = () => roomCandidates(state.directory.get(), me.member.id, null)
  const invite = peoplePicker(life, {
    id: 'debate-invite',
    label: strings.debates.invite,
    placeholder: strings.newMessage.placeholder,
    candidates: colleagues,
    sources: [state.directory],
    chosen: invited,
    limit: null,
  })
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
          actions.createDebate(
            {
              question: question.value.trim(),
              visibility: chosen === 'private' ? 'private' : 'open',
              limits: typed.limits,
              memberIds: [...invited.get()],
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
    colleagues().length > 0 &&
      h('div', { class: 'debate-invite' }, invite.element, h('small', {}, strings.debates.inviteHint)),
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
  if (model.kind === 'empty') return emptyWithPip(model.text)
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
          room.kind !== null && h('span', { class: 'debate-kind' }, room.kind),
          room.isPrivate && privateMarkOf(strings.debates.private),
          room.counts.map((count) => h('span', {}, count)),
          timeLabel(room.time),
        ),
      ),
    ),
  )
}

const newRoomButton = (context: ViewContext, me: AsRead.Me): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: 'primary new-flock-button',
      ...opensDialog(context, strings.debates.newRoom, (life) => newRoomDialog(context, life, me)),
    },
    strings.debates.newRoom,
  )

/** One form for every kind of flock: the kind is the first choice, and the fields below follow it. */
const newRoomDialog = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const debateForm = debateCreateForm(context, life, me)
  if (!featureOn('schedulingRooms', context.state.serverInfo.get())) return debateForm
  const meetingForm = schedulingForm(context, life, me)
  meetingForm.hidden = true
  const choose = (kind: 'debate' | 'scheduling'): void => {
    debateForm.hidden = kind !== 'debate'
    meetingForm.hidden = kind !== 'scheduling'
  }
  const kindOption = (kind: 'debate' | 'scheduling', label: string) =>
    h(
      'label',
      {},
      h('input', {
        type: 'radio',
        name: 'roomType',
        value: kind,
        checked: kind === 'debate',
        on: { change: () => choose(kind) },
      }),
      h('span', {}, label),
    )
  return h(
    'div',
    { class: 'new-room' },
    h(
      'fieldset',
      { class: 'room-type-choice' },
      h('legend', {}, strings.debates.roomType),
      kindOption('debate', strings.debates.typeDebate),
      kindOption('scheduling', strings.scheduling.newRoom),
    ),
    debateForm,
    meetingForm,
  )
}
