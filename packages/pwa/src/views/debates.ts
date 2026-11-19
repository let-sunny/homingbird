import {
  DEBATE_QUESTION_MAX,
  DEFAULT_DEBATE_LIMITS,
  type DebateLimits,
  type DebateSummary,
  type Me,
} from '@homingbird/protocol'
import { type Lifetime, h, region } from '@homingbird/ui'
import { launch } from '../actions.ts'
import { createDebate, loadDebates } from '../debate-actions.ts'
import { LIMIT_BOUNDS, limitsFrom, listedDebates, summaryStage } from '../debates.ts'
import { hrefFor } from '../routes.ts'
import { debates, debatesLoaded, directory, notice } from '../state.ts'
import { strings } from '../strings.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { emptyWithPip, field, loading, page, timeLabel } from './parts.ts'

/** Debate rooms: the rooms the person may see, and a way to open one for a question. */
export const debatesView = (life: Lifetime, me: Me): HTMLElement => {
  launch(loadDebates)
  return page(
    strings.debates.title,
    h('div', { class: 'debates-intro' }, h('p', {}, strings.debates.intro), newDebateButton(me)),
    region(life, [debates, debatesLoaded], () => {
      if (!debatesLoaded.get()) return loading()
      if (debates.get().length === 0) return emptyWithPip('searching', strings.debates.empty)
      return h('ul', { class: 'debate-list' }, listedDebates(debates.get()).map(debateCard))
    }),
  )
}

export const newDebateButton = (me: Me): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: 'primary new-debate',
      ...opensDialog(strings.debates.newRoom, () => createForm(me)),
    },
    strings.debates.newRoom,
  )

/** The four limits as number fields, filled with the given values. */
export const limitFields = (limits: DebateLimits): HTMLElement =>
  h(
    'fieldset',
    { class: 'debate-limits' },
    h('legend', {}, strings.debates.limits),
    ...(Object.keys(LIMIT_BOUNDS) as Array<keyof DebateLimits>).map((name) =>
      field(
        strings.debates[name],
        h('input', {
          type: 'number',
          name,
          inputmode: 'numeric',
          min: String(LIMIT_BOUNDS[name][0]),
          max: String(LIMIT_BOUNDS[name][1]),
          value: String(limits[name]),
          required: true,
        }),
      ),
    ),
  )

/** The limits typed into `limitFields`, or the reason they cannot be used. */
export const typedLimits = (form: HTMLFormElement) =>
  limitsFrom(
    Object.fromEntries(
      (Object.keys(LIMIT_BOUNDS) as Array<keyof DebateLimits>).map((name) => [
        name,
        form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? '',
      ]),
    ) as Record<keyof DebateLimits, string>,
  )

const debateCard = (summary: DebateSummary): HTMLElement =>
  h(
    'li',
    { class: `debate-card is-${summaryStage(summary)}`, data: { debate: summary.id } },
    h(
      'h2',
      { class: 'debate-question' },
      h('a', { href: hrefFor({ name: 'debate', id: summary.id }) }, summary.question),
    ),
    h(
      'p',
      { class: 'debate-meta' },
      h('span', { class: 'debate-stage' }, strings.debates.stage[summaryStage(summary)]),
      summary.visibility === 'private' &&
        h(
          'span',
          { class: 'private-mark' },
          h('span', { class: 'lock-mark', 'aria-hidden': 'true' }),
          strings.debates.private,
        ),
      h('span', {}, strings.debates.agentCount({ count: summary.participantIds.length })),
      h('span', {}, strings.debates.turnCount({ count: summary.turnCount })),
      timeLabel(summary.createdAt),
    ),
  )

const createForm = (me: Me): HTMLElement => {
  const question = h('textarea', {
    name: 'question',
    rows: '3',
    required: true,
    maxlength: String(DEBATE_QUESTION_MAX),
    placeholder: strings.debates.questionPlaceholder,
  })
  const colleagues = directory.get().filter((entry) => entry.member.id !== me.member.id)
  const form = h(
    'form',
    {
      class: 'dialog-body create-debate',
      on: {
        submit: (event) => {
          event.preventDefault()
          const typed = typedLimits(form)
          if ('problem' in typed) return notice.set({ kind: 'error', text: typed.problem })
          const chosen = form.querySelector<HTMLInputElement>('input[name="visibility"]:checked')?.value
          const invited = [...form.querySelectorAll<HTMLInputElement>('input[name="invite"]:checked')].map(
            (box) => box.value as Me['member']['id'],
          )
          launch(
            createDebate({
              question: question.value.trim(),
              visibility: chosen === 'private' ? 'private' : 'open',
              limits: typed.limits,
              memberIds: invited,
            }),
            (created) => {
              closeDialog()
              location.hash = hrefFor({ name: 'debate', id: created.id })
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
          colleagues.map((entry) =>
            h(
              'label',
              {},
              h('input', { type: 'checkbox', name: 'invite', value: entry.member.id }),
              h('span', {}, entry.member.name),
            ),
          ),
        ),
      ),
    limitFields(DEFAULT_DEBATE_LIMITS),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      h('button', { type: 'submit', class: 'primary' }, strings.debates.create),
    ),
  )
  return form
}
