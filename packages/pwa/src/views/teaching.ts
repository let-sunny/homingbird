import {
  ANSWER_TEXT_MAX,
  type Note,
  PRINCIPLE_TEXT_MAX,
  PRINCIPLE_TOPIC_MAX,
  PUBLIC_TEXT_MAX,
  type Principle,
  type PrincipleKind,
  type PrincipleOffer,
  principleAdvice,
  principleProblem,
  publicTextProblem,
} from '@homingbird/protocol'
import { type Child, type Lifetime, h, region } from '@homingbird/ui'
import {
  changePrinciple,
  deletePrinciple,
  dismissOffer,
  launch,
  markPrincipleWrong,
  refreshPrinciples,
  reorderPrinciples,
  savePrinciple,
} from '../actions.ts'
import { featureOn } from '../features.ts'
import {
  appliedPrinciples,
  countsShown,
  needsConfirmation,
  offersIn,
  problemText,
  sourceHost,
  suggestionText,
} from '../principles.ts'
import { channels, notice, taught } from '../state.ts'
import { percentOf, strings } from '../strings.ts'
import { placeName } from './agent-trust.ts'
import { closeDialog, opensDialog } from './dialog.ts'
import { button, field, loading } from './parts.ts'
import { todoList } from './todo-list.ts'

/** "What I have taught it": the person's principles, chances to teach, and milestones. */
export const taughtSection = (life: Lifetime): HTMLElement => {
  launch(refreshPrinciples)
  return region(
    life,
    [taught, channels],
    () => {
      const loaded = taught.get()
      if (loaded === null) return loading()
      if (loaded === 'failed') return h('p', { role: 'alert' }, strings.trust.loadFailed)
      return [
        h('p', { class: 'trust-footnote' }, strings.teach.intro),
        h(
          'div',
          { class: 'teach-actions' },
          teachButton(),
          h('small', {}, strings.teach.limit({ count: loaded.principles.length, limit: loaded.limit })),
        ),
        loaded.offers.length > 0 &&
          h(
            'section',
            { class: 'teach-chances', 'aria-labelledby': 'teach-chances' },
            h('h3', { id: 'teach-chances' }, strings.teach.chancesTitle),
            h(
              'ul',
              { class: 'chance-list' },
              loaded.offers.map((offer) => h('li', {}, chanceCard(offer))),
            ),
          ),
        loaded.principles.length === 0
          ? h(
              'div',
              { class: 'teach-empty' },
              h('strong', {}, strings.teach.empty),
              h('p', {}, strings.teach.emptyHint),
            )
          : null,
        principleList(loaded.principles),
        loaded.achievements.length > 0 &&
          h(
            'section',
            { class: 'milestones', 'aria-labelledby': 'milestones' },
            h('h3', { id: 'milestones' }, strings.teach.achievementsTitle),
            h(
              'ul',
              {},
              loaded.achievements.map((each) =>
                h('li', { class: 'milestone' }, strings.teach.achievements[each]),
              ),
            ),
          ),
        h('p', { class: 'trust-footnote' }, strings.teach.privacy),
        h('p', { class: 'trust-footnote teach-audit' }, strings.teach.audit),
      ]
    },
    { class: 'taught' },
  )
}

/** "Teach my agent": opens the guided form for a new principle. */
export const teachButton = (): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: 'primary teach-button',
      ...opensDialog(strings.teach.dialogTitle, () => principleForm(null, null)),
    },
    strings.teach.add,
  )

/** The chances to teach that came from one conversation, shown there right after the decision. */
export const chancesIn = (life: Lifetime, conversationId: string): HTMLElement =>
  region(
    life,
    [taught],
    () => {
      const loaded = taught.get()
      if (loaded === null || loaded === 'failed' || !featureOn('teaching')) return null
      const here = offersIn(loaded.offers, conversationId)
      return here.length === 0 ? null : here.map(chanceCard)
    },
    { class: 'chances-here' },
  )

/** On a draft card: the principles the agent says it applied, each with a way to say it was wrong here. */
export const appliedMarkers = (draft: Note): HTMLElement | null => {
  const loaded = taught.get()
  if (loaded === null || loaded === 'failed' || !featureOn('teaching')) return null
  const applied = appliedPrinciples(draft.basis, loaded.principles)
  if (applied.length === 0) return null
  return h(
    'ul',
    { class: 'applied-principles' },
    applied.map((principle) =>
      h(
        'li',
        {},
        h('span', { class: 'applied-mark' }, strings.teach.applied({ title: principle.topic })),
        button(
          strings.teach.wrongHere,
          () =>
            launch(markPrincipleWrong(principle.id, draft.id), () =>
              notice.set({ kind: 'info', text: strings.teach.wrongRecorded }),
            ),
          { class: 'link' },
        ),
      ),
    ),
  )
}

const chanceCard = (offer: PrincipleOffer): HTMLElement =>
  h(
    'div',
    { class: 'chance', role: 'note', data: { offer: offer.id } },
    h(
      'p',
      {},
      (offer.kind === 'edit' ? strings.teach.chanceEdit : strings.teach.chanceDiscard)({
        place: placeName(offer.place),
      }),
    ),
    h(
      'div',
      { class: 'chance-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'primary',
          ...opensDialog(strings.teach.dialogTitle, () => principleForm(offer, null)),
        },
        strings.teach.add,
      ),
      button(strings.teach.notNow, () => launch(dismissOffer(offer.id, false))),
      button(strings.teach.stopAsking, () => launch(dismissOffer(offer.id, true)), { class: 'link' }),
    ),
  )

const principleList = (principles: ReadonlyArray<Principle>): HTMLElement => {
  const byId = new Map(principles.map((principle) => [principle.id as string, principle]))
  const place = placeSelect(null, false)
  return todoList({
    label: strings.teach.listLabel,
    rows: principles.map((principle) => ({
      key: principle.id,
      name: principle.topic,
      enabled: principle.enabled,
      fields: [
        { name: 'topic', label: strings.teach.topic, value: principle.topic, maxLength: PRINCIPLE_TOPIC_MAX },
        {
          name: 'rule',
          label: principle.kind === 'answer' ? strings.teach.answer : strings.teach.rule,
          value: principle.rule,
          maxLength: principle.kind === 'answer' ? ANSWER_TEXT_MAX : PRINCIPLE_TEXT_MAX,
          wide: true,
        },
      ],
      details: principleDetails(principle),
      aside: publicSwitch(principle),
      problems: principleAdvice(principle)
        .filter((kind) => kind === 'forbidden')
        .map((kind) => strings.teach.advice[kind]),
      menu: [
        h(
          'button',
          {
            type: 'button',
            class: 'menu-item',
            ...opensDialog(strings.teach.dialogTitle, () => principleForm(null, principle)),
          },
          strings.teach.details,
        ),
      ],
    })),
    toggle: (id, enabled) => launch(changePrinciple(id, { enabled })),
    edit: (id, field, value) => launch(changePrinciple(id, { [field]: value })),
    move: (id, to) => {
      const order = principles.map((principle) => principle.id as string).filter((each) => each !== id)
      order.splice(Math.max(0, Math.min(order.length, to)), 0, id)
      launch(reorderPrinciples(order))
    },
    remove: (id) => {
      if (byId.has(id)) launch(deletePrinciple(id))
    },
    add: {
      label: strings.teach.addLabel,
      fields: [
        {
          name: 'topic',
          label: strings.teach.topic,
          value: '',
          maxLength: PRINCIPLE_TOPIC_MAX,
          placeholder: strings.teach.topicPlaceholder,
        },
        {
          name: 'rule',
          label: strings.teach.rule,
          value: '',
          maxLength: PRINCIPLE_TEXT_MAX,
          placeholder: strings.teach.rulePlaceholder,
          wide: true,
        },
      ],
      extra: field(strings.teach.place, place),
      warnings: (values) =>
        principleAdvice({ topic: values.topic ?? '', rule: values.rule ?? '' }).map(
          (kind) => strings.teach.advice[kind],
        ),
      submit: (values, done) =>
        launch(
          savePrinciple({
            topic: values.topic ?? '',
            rule: values.rule ?? '',
            source: null,
            place: place.value === '' ? null : place.value,
          }),
          () => {
            done()
            notice.set({ kind: 'info', text: strings.teach.saved })
          },
        ),
    },
  })
}

/** The quiet second line of a principle: where it applies, where it came from, and how it held up. */
const principleDetails = (principle: Principle): Child => {
  const counts = principle.counts === null ? null : countsShown(principle.counts)
  const host = principle.source === null ? null : sourceHost(principle.source)
  return h(
    'p',
    { class: 'principle-counts' },
    h('span', { class: 'principle-kind-badge' }, strings.teach.kindBadge[principle.kind]),
    h('span', {}, placeName(principle.place)),
    h('span', {}, strings.teach.origin[principle.origin]),
    host !== null && h('span', {}, strings.teach.sourceHost({ host })),
    counts !== null &&
      h(
        'span',
        {},
        counts.applied === 0
          ? strings.teach.notApplied
          : strings.teach.appliedCounts({
              count: counts.applied,
              asWritten: counts.sentAsWritten,
              edited: counts.edited,
              discarded: counts.discarded,
            }),
      ),
    counts !== null &&
      counts.sentAsWrittenShare !== null &&
      h('span', {}, strings.teach.share({ share: percentOf(counts.sentAsWrittenShare) })),
    counts !== null && counts.missed > 0 && h('span', {}, strings.teach.missed({ count: counts.missed })),
  )
}

/** Public or private: turning it on asks for a sentence for colleagues; turning it off needs nothing. */
const publicSwitch = (principle: Principle): HTMLElement => {
  const isPublic = principle.publicText !== null
  const label = (isPublic ? strings.teach.makePrivate : strings.teach.makePublic)({ name: principle.topic })
  return h(
    'button',
    {
      type: 'button',
      class: 'todo-public',
      'aria-pressed': String(isPublic),
      'aria-label': label,
      title: label,
      ...(isPublic
        ? {
            on: {
              click: () =>
                launch(changePrinciple(principle.id, { publicText: null }), () =>
                  notice.set({ kind: 'info', text: strings.teach.madePrivate }),
                ),
            },
          }
        : opensDialog(strings.teach.dialogTitle, () => principleForm(null, principle, true))),
    },
    isPublic ? strings.teach.isPublic : strings.teach.isPrivate,
  )
}

/** The guided form: what it is, a short title, how to answer, an optional source, warnings while typing. */
const principleForm = (
  offer: PrincipleOffer | null,
  editing: Principle | null,
  showingPublic = false,
): Child => {
  const kindChoice = (kind: PrincipleKind) =>
    h('input', {
      type: 'radio',
      name: 'kind',
      value: kind,
      checked: (editing?.kind ?? 'rule') === kind,
    }) as HTMLInputElement
  const asRule = kindChoice('rule')
  const asAnswer = kindChoice('answer')
  const kind = (): PrincipleKind => (asAnswer.checked ? 'answer' : 'rule')
  const publicBox = h('input', {
    type: 'checkbox',
    name: 'public',
    checked: showingPublic || (editing?.publicText ?? null) !== null,
  }) as HTMLInputElement
  const publicText = h('input', {
    name: 'publicText',
    maxlength: String(PUBLIC_TEXT_MAX),
    value: editing?.publicText ?? '',
  }) as HTMLInputElement
  const publicPart = h(
    'div',
    { class: 'principle-public' },
    field(strings.teach.publicLabel, publicText, strings.teach.publicHint),
    h('p', { class: 'flow-warning', role: 'note' }, strings.teach.publicWarning),
  )
  const topic = h('input', {
    name: 'topic',
    required: true,
    maxlength: String(PRINCIPLE_TOPIC_MAX),
    value: editing?.topic ?? '',
  })
  const rule = h('textarea', {
    name: 'rule',
    rows: '3',
    maxlength: String(PRINCIPLE_TEXT_MAX),
  })
  const ruleLabel = h('span', { class: 'field-label' }, strings.teach.rule)
  const ruleHint = h('small', {}, strings.teach.ruleHint)
  const switchToAnswer = button(strings.teach.switchToAnswer, () => {
    asAnswer.checked = true
    reflect()
  })
  rule.value = editing?.rule ?? (offer?.suggestion == null ? '' : suggestionText(offer.suggestion))
  const problem = h('p', { class: 'principle-problem', role: 'alert', hidden: true })
  const source = h('input', {
    name: 'source',
    type: 'url',
    placeholder: 'https://',
    value: editing?.source ?? '',
  })
  const host = h('small', { class: 'source-host', 'aria-live': 'polite' })
  const place = placeSelect(offer?.place ?? editing?.place ?? null, editing !== null)
  const advice = h('ul', { class: 'principle-advice', 'aria-live': 'polite' })
  const confirmBox = h('input', { type: 'checkbox', name: 'confirmed' })
  const confirm = h('label', { class: 'choice principle-confirm' }, confirmBox, strings.teach.confirm)
  const confirmHint = h('small', {}, strings.teach.confirmHint)
  const save = h('button', { type: 'submit', class: 'primary' }, strings.teach.save)
  const reflect = (): void => {
    const shownHost = source.value.trim() === '' ? null : sourceHost(source.value.trim())
    host.textContent = shownHost === null ? '' : strings.teach.sourceHost({ host: shownHost })
    const answering = kind() === 'answer'
    ruleLabel.textContent = answering ? strings.teach.answer : strings.teach.rule
    ruleHint.textContent = answering
      ? strings.teach.answerHint({ max: ANSWER_TEXT_MAX })
      : strings.teach.ruleHint
    rule.maxLength = answering ? ANSWER_TEXT_MAX : PRINCIPLE_TEXT_MAX
    rule.required = !answering
    publicPart.hidden = !publicBox.checked
    publicText.required = publicBox.checked
    advice.replaceChildren(
      ...principleAdvice({ kind: kind(), topic: topic.value, rule: rule.value }).map((each) =>
        h(
          'li',
          { class: `advice is-${each.replace('_', '-')}` },
          strings.teach.advice[each],
          each === 'stored_answer' && switchToAnswer,
        ),
      ),
    )
    const confirming = needsConfirmation(offer, rule.value)
    confirm.hidden = !confirming
    confirmHint.hidden = !confirming
    save.disabled = confirming && !confirmBox.checked
  }
  for (const control of [topic, rule, source, confirmBox]) control.addEventListener('input', reflect)
  for (const control of [confirmBox, asRule, asAnswer, publicBox]) control.addEventListener('change', reflect)
  reflect()
  return h(
    'form',
    {
      class: 'form principle-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          const sourceValue = source.value.trim() === '' ? null : source.value.trim()
          const shared = publicBox.checked && publicText.value.trim() !== '' ? publicText.value.trim() : null
          const item = { kind: kind(), topic: topic.value, rule: rule.value, source: sourceValue }
          const shown = problemText(
            principleProblem(item) ??
              (shared === null
                ? null
                : publicTextProblem(shared, { ...item, place: editing?.place ?? (place.value || null) })),
          )
          problem.textContent = shown ?? ''
          problem.hidden = shown === null
          if (shown !== null) return
          const done = (): void => {
            closeDialog()
            notice.set({ kind: 'info', text: strings.teach.saved })
          }
          if (editing !== null)
            return launch(
              changePrinciple(editing.id, {
                kind: kind(),
                topic: topic.value.trim(),
                rule: rule.value.trim(),
                source: sourceValue,
                publicText: shared,
              }),
              done,
            )
          launch(
            savePrinciple({
              kind: kind(),
              topic: topic.value.trim(),
              rule: rule.value.trim(),
              source: sourceValue,
              place: place.value === '' ? null : place.value,
              publicText: shared,
              ...(offer !== null && { offerId: offer.id, confirmed: confirmBox.checked }),
            }),
            done,
          )
        },
      },
    },
    h(
      'fieldset',
      { class: 'principle-kind' },
      h('legend', {}, strings.teach.kindLabel),
      h('label', { class: 'choice' }, asRule, strings.teach.kinds.rule),
      h('label', { class: 'choice' }, asAnswer, strings.teach.kinds.answer),
    ),
    field(strings.teach.topic, topic, strings.teach.topicHint),
    h('label', { class: 'field' }, ruleLabel, rule, ruleHint),
    advice,
    field(strings.teach.source, source, strings.teach.sourceHint),
    host,
    field(strings.teach.place, place),
    h('label', { class: 'choice' }, publicBox, strings.teach.publicToggle),
    publicPart,
    confirm,
    confirmHint,
    problem,
    save,
  )
}

const placeSelect = (chosen: string | null, disabled: boolean): HTMLSelectElement =>
  h(
    'select',
    { name: 'place', disabled },
    placeChoices(chosen).map((choice) =>
      h('option', { value: choice.value, selected: choice.selected }, choice.label),
    ),
  )

const placeChoices = (
  chosen: string | null,
): ReadonlyArray<{ readonly value: string; readonly label: string; readonly selected: boolean }> => {
  const slugs = [
    ...new Set([
      ...channels
        .get()
        .filter((channel) => channel.joined)
        .map((channel) => channel.slug),
      ...(chosen === null ? [] : [chosen]),
    ]),
  ]
  return [
    { value: '', label: strings.teach.placeAnywhere, selected: chosen === null },
    ...slugs.map((slug) => ({ value: slug, label: placeName(slug), selected: slug === chosen })),
  ]
}
