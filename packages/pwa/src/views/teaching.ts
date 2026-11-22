import { PRINCIPLE_TEXT_MAX, PRINCIPLE_TOPIC_MAX, type PrincipleKind } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region } from '@homingbird/ui'
import { featureOn } from '../features.ts'
import {
  type AppliedMarker,
  type ChanceModel,
  type PrincipleRow,
  type TaughtModel,
  type TeachSeed,
  addRowKinds,
  addRowWarnings,
  appliedModel,
  chancesHere,
  placeChoices,
  reordered,
  taughtModel,
} from '../models/teaching.ts'
import { strings } from '../strings.ts'
import { autoSendForm } from './auto-send-form.ts'
import type { ViewContext } from './context.ts'
import { opensDialog } from './dialog.ts'
import { hinted } from './hint.ts'
import { button, field, loading } from './parts.ts'
import { principleForm } from './principle-form.ts'
import { todoList } from './todo-list.ts'

/** "What I have taught it": the person's principles, chances to teach, and milestones. */
export const taughtSection = (context: ViewContext, life: Lifetime): HTMLElement => {
  context.actions.refreshPrinciples()
  return region(
    life,
    [context.state.taught, context.state.channels],
    () => renderTaught(taughtModel(context.state.taught.get()), context),
    { class: 'taught' },
  )
}

/** "Teach my agent": opens the guided form for a new principle. */
export const teachButton = (context: ViewContext): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: 'primary teach-button',
      ...opensDialog(context, strings.teach.dialogTitle, () => principleForm(context, null, null, false)),
    },
    strings.teach.add,
  )

/** The chances to teach that came from one conversation, shown there right after the decision. */
export const chancesIn = (context: ViewContext, life: Lifetime, conversationId: string): HTMLElement =>
  region(
    life,
    [context.state.taught],
    () => {
      const chances = chancesHere(
        context.state.taught.get(),
        featureOn('teaching', context.state.serverInfo.get()),
        conversationId,
      )
      return chances.length === 0 ? null : chances.map((chance) => chanceLine(chance, context))
    },
    { class: 'chances-here' },
  )

/** On a draft card: what the agent says it applied, each matched principle with a way to say it was wrong here. */
export const appliedMarkers = (
  context: ViewContext,
  draft: Parameters<typeof appliedModel>[0],
): HTMLElement | null => {
  const markers = appliedModel(
    draft,
    context.state.taught.get(),
    featureOn('teaching', context.state.serverInfo.get()),
  )
  return renderAppliedMarkers(markers, context)
}

export const renderAppliedMarkers = (
  markers: ReadonlyArray<AppliedMarker>,
  context: ViewContext,
): HTMLElement | null =>
  markers.length === 0
    ? null
    : h(
        'ul',
        { class: 'applied-principles' },
        markers.map((marker) =>
          h(
            'li',
            {},
            h('span', { class: 'applied-mark' }, marker.text),
            marker.principleId !== null &&
              button(
                strings.teach.wrongHere,
                () =>
                  context.actions.markPrincipleWrong(marker.principleId!, marker.noteId, {
                    done: () => context.state.notice.set({ kind: 'info', text: strings.teach.wrongRecorded }),
                  }),
                { class: 'link' },
              ),
          ),
        ),
      )

/** Teaching from a miss: the guided form, filled with what the place of the miss knows. */
export const teachFromMiss = (
  context: ViewContext,
  label: string,
  seed: TeachSeed,
  className = 'teach-from-miss',
): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: className,
      ...opensDialog(context, strings.teach.dialogTitle, () =>
        principleForm(context, null, null, false, { kind: 'own', seed }),
      ),
    },
    label,
  )

/** A chance to teach as one line in the conversation it came from, once the moment to undo is over. */
const chanceLine = (chance: ChanceModel, context: ViewContext): HTMLElement =>
  h(
    'p',
    { class: 'chance chance-line', role: 'note', data: { offer: chance.offer.id } },
    h('span', {}, chance.here.text),
    h(
      'button',
      {
        type: 'button',
        class: 'link teach-from-chance',
        ...opensDialog(context, strings.teach.dialogTitle, () =>
          principleForm(context, chance.offer, null, false),
        ),
      },
      chance.here.teach,
    ),
    button(strings.teach.notNow, () => context.actions.dismissOffer(chance.offer.id, false), {
      class: 'link',
    }),
    button(strings.teach.stopAsking, () => context.actions.dismissOffer(chance.offer.id, true), {
      class: 'link',
    }),
  )

const chanceCard = (chance: ChanceModel, context: ViewContext): HTMLElement =>
  h(
    'div',
    { class: 'chance', role: 'note', data: { offer: chance.offer.id } },
    h('p', {}, chance.text),
    h(
      'div',
      { class: 'chance-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'primary',
          ...opensDialog(context, strings.teach.dialogTitle, () =>
            principleForm(context, chance.offer, null, false),
          ),
        },
        strings.teach.add,
      ),
      button(strings.teach.notNow, () => context.actions.dismissOffer(chance.offer.id, false)),
      button(strings.teach.stopAsking, () => context.actions.dismissOffer(chance.offer.id, true), {
        class: 'link',
      }),
    ),
  )

const principleList = (rows: ReadonlyArray<PrincipleRow>, context: ViewContext): HTMLElement => {
  const { actions, state } = context
  const ids = rows.map((row) => row.principle.id as string)
  const place = placeSelect(context, null, false)
  let kind: PrincipleKind = 'rule'
  return todoList({
    label: strings.teach.listLabel,
    rows: rows.map((row) => ({
      key: row.principle.id,
      name: row.principle.topic,
      enabled: row.principle.enabled,
      fields: row.fields,
      details: h(
        'p',
        { class: 'principle-counts' },
        row.principle.kind === 'unknown'
          ? h('span', { class: 'principle-kind-badge' }, row.kindBadge)
          : hinted(
              context,
              'principleKind',
              row.principle.kind === 'rule' ? strings.hints.kindRule : strings.hints.kindAnswer,
              h('span', { class: 'principle-kind-badge' }, row.kindBadge),
            ),
        row.details.map((detail) => h('span', {}, detail)),
      ),
      aside: hinted(
        context,
        'principleVisibility',
        row.publicSwitch.isPublic ? strings.hints.makePrivate : strings.hints.makePublic,
        publicSwitch(row, context),
      ),
      problems: row.problems,
      menu: [
        h(
          'button',
          {
            type: 'button',
            class: 'menu-item',
            ...opensDialog(context, strings.teach.dialogTitle, () =>
              principleForm(context, null, row.principle, false),
            ),
          },
          strings.teach.details,
        ),
        ...(row.autoSend === null
          ? []
          : [
              h(
                'button',
                {
                  type: 'button',
                  class: 'menu-item',
                  ...opensDialog(context, row.autoSend.title, () => autoSendForm(context, row.principle)),
                },
                row.autoSend.menu,
              ),
            ]),
      ],
    })),
    toggle: (id, enabled) => actions.changePrinciple(id, { enabled }),
    edit: (id, name, value) => actions.changePrinciple(id, { [name]: value }),
    move: (id, to) => actions.reorderPrinciples(reordered(ids, id, to)),
    remove: (id) => {
      if (ids.includes(id)) actions.deletePrinciple(id)
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
      extra: (reflect) => [
        kindChoice((chosen) => {
          kind = chosen
          reflect()
        }),
        field(strings.teach.place, place, strings.teach.placeHint),
      ],
      warnings: (values) => addRowWarnings(values, kind),
      submit: (values, done) =>
        actions.savePrinciple(
          {
            kind,
            topic: values.topic ?? '',
            rule: values.rule ?? '',
            source: null,
            place: place.value === '' ? null : place.value,
          },
          {
            done: () => {
              done()
              state.notice.set({ kind: 'info', text: strings.teach.saved })
            },
          },
        ),
    },
  })
}

/**
 * Rule or answer for the add row. Choosing one also renames the text field beside it, which the list
 * draws itself, so it is found in the row this choice sits in.
 */
const kindChoice = (choose: (kind: PrincipleKind) => void): HTMLElement => {
  const model = addRowKinds('rule')
  const rename = (event: Event, kind: PrincipleKind): void => {
    const shown = addRowKinds(kind)
    const row = (event.currentTarget as HTMLElement).closest('.todo-add')
    const text = row?.querySelector<HTMLTextAreaElement>('[name="rule"]')
    if (text) {
      text.placeholder = shown.textLabel
      text.setAttribute('aria-label', shown.textLabel)
      text.maxLength = shown.maxLength
    }
  }
  return h(
    'fieldset',
    { class: 'principle-kind add-row-kind' },
    h('legend', {}, model.label),
    model.choices.map((choice) =>
      h(
        'label',
        { class: 'choice' },
        h('input', {
          type: 'radio',
          name: 'add-kind',
          value: choice.kind,
          checked: choice.checked,
          on: {
            change: (event) => {
              rename(event, choice.kind)
              choose(choice.kind)
            },
          },
        }),
        choice.label,
      ),
    ),
  )
}

/** Public or private: turning it on asks for a sentence for colleagues; turning it off needs nothing. */
const publicSwitch = (row: PrincipleRow, context: ViewContext): HTMLElement => {
  const shown = row.publicSwitch
  return h(
    'button',
    {
      type: 'button',
      class: 'todo-public',
      'aria-pressed': String(shown.isPublic),
      'aria-label': shown.label,
      ...(shown.isPublic
        ? {
            on: {
              click: () =>
                context.actions.changePrinciple(
                  row.principle.id,
                  { publicText: null },
                  { done: () => context.state.notice.set({ kind: 'info', text: strings.teach.madePrivate }) },
                ),
            },
          }
        : opensDialog(context, strings.teach.dialogTitle, () =>
            principleForm(context, null, row.principle, true),
          )),
    },
    shown.text,
  )
}

/** The place a principle applies to, as a choice among the channels the person is in. */
export const placeSelect = (
  context: ViewContext,
  chosen: string | null,
  disabled: boolean,
): HTMLSelectElement =>
  h(
    'select',
    { name: 'place', disabled },
    placeChoices(context.state.channels.get(), chosen).map((choice) =>
      h('option', { value: choice.value, selected: choice.selected }, choice.label),
    ),
  )

const renderTaught = (model: TaughtModel, context: ViewContext): Child => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'failed') return h('p', { role: 'alert' }, model.text)
  return [
    h('p', { class: 'trust-footnote' }, model.intro),
    h('div', { class: 'teach-actions' }, teachButton(context), h('small', {}, model.limit)),
    model.chances.length > 0 &&
      h(
        'section',
        { class: 'teach-chances', 'aria-labelledby': 'teach-chances' },
        hinted(
          context,
          'teachingChances',
          strings.hints.teachingChances,
          h('h3', { id: 'teach-chances' }, strings.teach.chancesTitle),
        ),
        h(
          'ul',
          { class: 'chance-list' },
          model.chances.map((chance) => h('li', {}, chanceCard(chance, context))),
        ),
      ),
    model.empty !== null &&
      h('div', { class: 'teach-empty' }, h('strong', {}, model.empty.title), h('p', {}, model.empty.hint)),
    principleList(model.principles, context),
    model.milestones !== null &&
      h(
        'section',
        { class: 'milestones', 'aria-labelledby': 'milestones' },
        h('h3', { id: 'milestones' }, model.milestones.title),
        h(
          'ul',
          {},
          model.milestones.items.map((item) => h('li', { class: 'milestone' }, item)),
        ),
      ),
    h('p', { class: 'trust-footnote' }, model.footnotes[0]),
    h('p', { class: 'trust-footnote teach-audit' }, model.footnotes[1]),
  ]
}
