import type { AsRead } from '@homingbird/protocol'
import { type EditorState, SLOTS } from '@homingbird/sprites'
import { type Lifetime, type Signal, h, region, signal } from '@homingbird/ui'
import {
  type Workbench,
  characterOf,
  problemsOf,
  renamed,
  specOf,
  surprise,
  workbenchFor,
  workbenchFromBuiltIn,
  workbenchFromLink,
} from '../characters.ts'
import { featureOn } from '../features.ts'
import {
  type EditorControlsModel,
  editorControlsModel,
  optionLabel,
  problemsModel,
} from '../models/character.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { askMyAgent, characterPreview } from './character.ts'
import type { ViewContext } from './context.ts'
import { button, field, page } from './parts.ts'

/** The editor page. A draft from an agent's link opens as a layer; nothing is saved but by the button. */
export const characterEditorView = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  draft: string | null,
  from: string | null,
): HTMLElement => {
  const { state, actions } = context
  const fromLink = draft === null ? null : workbenchFromLink(draft)
  if (draft !== null && fromLink === null)
    state.notice.set({ kind: 'error', text: strings.character.badLink })
  const start =
    fromLink ??
    (from === null ? null : workbenchFromBuiltIn(from)) ??
    workbenchFor(characterOf(me.member, featureOn('characters', state.serverInfo.get())))
  const bench = signal<Workbench>(start)
  const controls = editorControls(bench)
  life.add(bench.subscribe((current) => controls.sync(editorControlsModel(current))))
  controls.sync(editorControlsModel(start))
  const use = (): void =>
    actions.useCharacter(specOf(bench.get()), {
      done: () => {
        state.notice.set({ kind: 'info', text: strings.character.saved })
        context.page.go(hrefFor({ name: 'profile' }))
      },
    })
  return page(
    strings.character.editorTitle,
    start.layer?.source === 'agent' &&
      h('p', { class: 'banner', role: 'note' }, strings.character.agentDraftLoaded),
    h(
      'div',
      { class: 'character-editor' },
      h(
        'section',
        { class: 'character-review', 'aria-label': strings.character.preview },
        region(life, [bench], () => characterPreview(context, specOf(bench.get())), {
          class: 'character-preview-host',
        }),
        region(life, [bench], () => problemList(problemsOf(bench.get())), { class: 'character-problems' }),
        region(
          life,
          [bench],
          () =>
            h(
              'div',
              { class: 'character-actions' },
              button(strings.character.use, use, {
                class: 'primary',
                disabled: problemsOf(bench.get()).length > 0,
                name: 'use',
              }),
              button(strings.character.surprise, () => bench.set(surprise(context.random.seed())), {
                name: 'surprise',
              }),
              button(strings.character.startOver, () => bench.set(start), { name: 'start-over' }),
              h('a', { class: 'button', href: hrefFor({ name: 'profile' }) }, strings.cancel),
            ),
          { class: 'character-actions-host' },
        ),
        askMyAgent(),
      ),
      h(
        'form',
        { class: 'character-controls', on: { submit: (event) => event.preventDefault() } },
        controls.nodes,
      ),
    ),
  )
}

const problemList = (problems: ReadonlyArray<string>): HTMLElement => {
  const model = problemsModel(problems)
  return model.passes
    ? h('p', { class: 'character-passes', role: 'status' }, '✓ ', model.text)
    : h(
        'div',
        { role: 'status' },
        h('p', { class: 'field-label' }, model.text),
        h(
          'ul',
          { class: 'character-problem-list' },
          model.items.map((item) => h('li', {}, item)),
        ),
      )
}

interface Controls {
  readonly nodes: ReadonlyArray<HTMLElement>
  readonly sync: (model: EditorControlsModel) => void
}

const editorControls = (bench: Signal<Workbench>): Controls => {
  const change = (edit: (editor: EditorState) => EditorState): void =>
    bench.update((current) => ({ ...current, editor: edit(current.editor) }))
  const name = h('input', {
    name: 'character-name',
    maxlength: '20',
    required: true,
    on: { input: () => bench.update((current) => renamed(current, name.value)) },
  })
  const paletteInputs = PALETTE_FIELDS.map(([key, label]) => {
    const input = h('input', {
      type: 'color',
      name: `color-${key}`,
      on: {
        input: () => change((editor) => ({ ...editor, palette: { ...editor.palette, [key]: input.value } })),
      },
    })
    return { key, input, node: field(strings.character[label], input) }
  })
  const markingInputs = (['marking', 'detail'] as const).map((key) => {
    const input = h('input', {
      type: 'color',
      name: `color-${key}`,
      on: { input: () => change((editor) => ({ ...editor, [key]: input.value })) },
    })
    return { key, input, node: field(strings.character[key], input) }
  })
  const eyeColor = h('input', {
    type: 'color',
    name: 'color-K',
    on: {
      input: () => change((editor) => ({ ...editor, palette: { ...editor.palette, K: eyeColor.value } })),
    },
  })
  const eyeAuto = h('input', {
    type: 'checkbox',
    name: 'eye-auto',
    on: { change: () => change((editor) => ({ ...editor, eye: eyeAuto.checked ? 'auto' : 'set' })) },
  })
  const feet = h('input', {
    type: 'checkbox',
    name: 'feet',
    on: { change: () => change((editor) => ({ ...editor, feet: feet.checked })) },
  })
  const keepLayer = h('input', {
    type: 'checkbox',
    name: 'keep-layer',
    on: {
      change: () =>
        bench.update((current) =>
          current.layer === null
            ? current
            : { ...current, layer: { ...current.layer, kept: keepLayer.checked } },
        ),
    },
  })
  const layerText = h('span', {})
  const layerRow = h(
    'label',
    { class: 'choice character-layer' },
    keepLayer,
    h('span', {}, strings.character.keepLayer, layerText),
  )
  const slots = SLOTS.map((slot) => {
    const options = slot.options.map((option) => {
      const input = h('input', {
        type: 'radio',
        name: `part-${slot.id}`,
        value: option.id,
        on: {
          change: () => change((editor) => ({ ...editor, parts: { ...editor.parts, [slot.id]: option.id } })),
        },
      })
      const reason = h('small', { class: 'character-blocked' })
      const label = h(
        'label',
        { class: 'choice character-part' },
        input,
        h('span', {}, optionLabel(slot.id, option.id), reason),
      )
      return { input, reason, label }
    })
    const node = h(
      'fieldset',
      { class: 'character-slot', data: { slot: slot.id } },
      h('legend', {}, strings.character.slots[slot.id]),
      options.map((option) => option.label),
    )
    return { slot, options, node }
  })

  const sync = (model: EditorControlsModel): void => {
    if (name.value !== model.name) name.value = model.name
    for (const { key, input } of paletteInputs) input.value = model.palette[key]
    for (const { key, input } of markingInputs) input.value = model[key]
    eyeColor.value = model.palette.K
    eyeAuto.checked = model.eyeAuto
    eyeColor.disabled = model.eyeAuto
    feet.checked = model.feet.checked
    feet.disabled = model.feet.disabled
    layerRow.hidden = model.layer === null
    keepLayer.checked = model.layer?.kept === true
    layerText.textContent = model.layer?.text ?? ''
    for (const { slot, options } of slots)
      for (const [index, option] of options.entries()) {
        const shown = model.parts[slot.id]![index]!
        option.input.checked = shown.checked
        option.input.disabled = shown.disabled
        option.reason.textContent = shown.reason
      }
  }

  return {
    sync,
    nodes: [
      field(strings.character.name, name, strings.character.nameHint),
      h(
        'fieldset',
        { class: 'character-colors' },
        h('legend', {}, strings.character.colors),
        paletteInputs.map(({ node }) => node),
        markingInputs.map(({ node }) => node),
        field(strings.character.eye, eyeColor),
        h('label', { class: 'choice' }, eyeAuto, h('span', {}, strings.character.eyeAuto)),
        h('label', { class: 'choice' }, feet, h('span', {}, strings.character.showFeet)),
      ),
      layerRow,
      h(
        'fieldset',
        { class: 'character-parts' },
        h('legend', {}, strings.character.parts),
        slots.map(({ node }) => node),
      ),
    ],
  }
}

const PALETTE_FIELDS = [
  ['B', 'body'],
  ['D', 'wing'],
  ['O', 'beak'],
  ['F', 'feet'],
] as const
