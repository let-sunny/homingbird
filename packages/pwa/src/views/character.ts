import { BUILT_IN_CHARACTERS, type CharacterSpec, type Me, isSameCharacter } from '@homingbird/protocol'
import { type EditorState, SLOTS, type SlotId } from '@homingbird/sprites'
import { type Lifetime, h, region, signal } from '@homingbird/ui'
import { launch, useCharacter } from '../actions.ts'
import {
  PIGEON,
  PREVIEW_STATES,
  type Workbench,
  blockedParts,
  characterOf,
  problemKindOf,
  problemsOf,
  renamed,
  specOf,
  surprise,
  workbenchFor,
  workbenchFromBuiltIn,
  workbenchFromLink,
} from '../characters.ts'
import { hrefFor } from '../routes.ts'
import { notice } from '../state.ts'
import { strings } from '../strings.ts'
import { characterAvatar, characterName, memberAvatar } from './character-avatar.ts'
import { button, field, page } from './parts.ts'

/** "My character" on the profile: the character in use, the 24 built-ins to pick from, and the editor. */
export const myCharacterSection = (life: Lifetime, me: Me): HTMLElement => {
  const current = characterOf(me.member)
  const picked = signal<CharacterSpec | null>(null)
  const choices = BUILT_IN_CHARACTERS.map((preset) => {
    const choice = h(
      'button',
      {
        type: 'button',
        class: 'character-choice',
        'aria-pressed': 'false',
        data: { character: preset.id },
        on: { click: () => picked.set(preset) },
      },
      characterAvatar(preset, { scale: 2 }),
      h('span', {}, characterName(preset)),
    )
    return { preset, choice }
  })
  life.add(
    picked.subscribe((chosen) => {
      for (const { preset, choice } of choices)
        choice.setAttribute('aria-pressed', String(chosen !== null && preset.id === chosen.id))
    }),
  )
  return h(
    'fieldset',
    { class: 'appearance my-character' },
    h('legend', {}, strings.character.title),
    h('p', {}, strings.character.intro),
    h(
      'div',
      { class: 'character-current' },
      memberAvatar(me.member, { scale: 4 }),
      h(
        'div',
        { class: 'character-current-text' },
        h('p', {}, strings.character.current({ character: characterName(current) })),
        h(
          'div',
          { class: 'character-actions' },
          h('a', { class: 'button', href: hrefFor(EDITOR) }, strings.character.makeOwn),
          current.id !== PIGEON.id &&
            button(strings.character.backToPigeon, () => launch(useCharacter(null), savedNotice)),
        ),
      ),
    ),
    h('p', { class: 'field-label' }, strings.character.builtIn),
    h(
      'ul',
      { class: 'character-grid' },
      choices.map(({ choice }) => h('li', {}, choice)),
    ),
    region(life, [picked], () => {
      const chosen = picked.get()
      if (chosen === null) return null
      return h(
        'div',
        { class: 'character-picked' },
        h('p', { role: 'status' }, strings.character.selected({ character: characterName(chosen) })),
        characterPreview(chosen),
        h(
          'div',
          { class: 'character-actions' },
          button(
            strings.character.use,
            () => launch(useCharacter(chosen.id === PIGEON.id ? null : chosen), savedNotice),
            { class: 'primary', disabled: isSameCharacter(chosen, current) },
          ),
          chosen.id !== PIGEON.id &&
            h(
              'a',
              { class: 'button', href: hrefFor({ ...EDITOR, from: chosen.id }) },
              strings.character.editThis,
            ),
        ),
      )
    }),
    askMyAgent(),
  )
}

/** The editor page. A draft from an agent's link opens as a layer; nothing is saved but by the button. */
export const characterEditorView = (
  life: Lifetime,
  me: Me,
  draft: string | null,
  from: string | null,
): HTMLElement => {
  const fromLink = draft === null ? null : workbenchFromLink(draft)
  if (draft !== null && fromLink === null) notice.set({ kind: 'error', text: strings.character.badLink })
  const start =
    fromLink ?? (from === null ? null : workbenchFromBuiltIn(from)) ?? workbenchFor(characterOf(me.member))
  const bench = signal<Workbench>(start)
  const change = (edit: (editor: EditorState) => EditorState): void =>
    bench.update((current) => ({ ...current, editor: edit(current.editor) }))
  const controls = editorControls(bench, change)
  life.add(bench.subscribe(controls.sync))
  controls.sync(start)

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
        region(life, [bench], () => characterPreview(specOf(bench.get())), {
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
              button(
                strings.character.use,
                () =>
                  launch(useCharacter(specOf(bench.get())), () => {
                    savedNotice()
                    location.hash = hrefFor({ name: 'profile' })
                  }),
                { class: 'primary', disabled: problemsOf(bench.get()).length > 0, name: 'use' },
              ),
              button(strings.character.surprise, () => bench.set(surprise(randomSeed())), {
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

/** The character on a light and a dark ground, idle and in the states colleagues see most, each named. */
export const characterPreview = (spec: CharacterSpec): HTMLElement =>
  h(
    'div',
    { class: 'character-preview' },
    (['light', 'dark'] as const).map((ground) =>
      h(
        'figure',
        { class: `character-ground is-${ground}` },
        h('figcaption', {}, ground === 'light' ? strings.character.onLight : strings.character.onDark),
        h(
          'ul',
          { class: 'character-states' },
          PREVIEW_STATES.map((state) =>
            h(
              'li',
              {},
              characterAvatar(spec, {
                scale: 3,
                state,
                motion: 'loop',
                label: `${characterName(spec)}: ${strings.character.states[state]}`,
              }),
              h('span', { 'aria-hidden': 'true' }, strings.character.states[state]),
            ),
          ),
        ),
      ),
    ),
  )

const EDITOR = { name: 'character', draft: null, from: null } as const

const savedNotice = (): void => notice.set({ kind: 'info', text: strings.character.saved })

const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0]!

const askMyAgent = (): HTMLElement =>
  h(
    'details',
    { class: 'ask-my-agent' },
    h('summary', {}, strings.character.askAgent),
    h('p', {}, strings.character.askAgentHint),
  )

const problemList = (problems: ReadonlyArray<string>): HTMLElement =>
  problems.length === 0
    ? h('p', { class: 'character-passes', role: 'status' }, '✓ ', strings.character.passes)
    : h(
        'div',
        { role: 'status' },
        h('p', { class: 'field-label' }, strings.character.problemsTitle),
        h(
          'ul',
          { class: 'character-problem-list' },
          [...new Set(problems.map(problemKindOf))].map((kind) =>
            h('li', {}, strings.character.problems[kind]),
          ),
        ),
      )

interface Controls {
  readonly nodes: ReadonlyArray<HTMLElement>
  readonly sync: (workbench: Workbench) => void
}

const editorControls = (
  bench: {
    readonly get: () => Workbench
    readonly update: (change: (current: Workbench) => Workbench) => void
  },
  change: (edit: (editor: EditorState) => EditorState) => void,
): Controls => {
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
      return { id: option.id, input, reason, label }
    })
    const node = h(
      'fieldset',
      { class: 'character-slot', data: { slot: slot.id } },
      h('legend', {}, strings.character.slots[slot.id]),
      options.map((option) => option.label),
    )
    return { slot, options, node }
  })

  const sync = (workbench: Workbench): void => {
    const editor = workbench.editor
    if (name.value !== editor.name) name.value = editor.name
    for (const { key, input } of paletteInputs) input.value = editor.palette[key].toLowerCase()
    for (const { key, input } of markingInputs) input.value = editor[key].toLowerCase()
    eyeColor.value = editor.palette.K.toLowerCase()
    eyeAuto.checked = editor.eye === 'auto'
    eyeColor.disabled = editor.eye === 'auto'
    feet.checked = editor.feet && editor.parts.under === 'none'
    feet.disabled = editor.parts.under !== 'none'
    layerRow.hidden = workbench.layer === null
    keepLayer.checked = workbench.layer?.kept === true
    layerText.textContent =
      workbench.layer === null
        ? ''
        : workbench.layer.source === 'built-in'
          ? strings.character.layer['built-in']({ character: builtInName(workbench.layer.builtIn) })
          : strings.character.layer[workbench.layer.source]
    const blocked = blockedParts(workbench)
    for (const { slot, options } of slots)
      for (const option of options) {
        const reasons = blocked[slot.id][option.id] ?? []
        option.input.checked = editor.parts[slot.id] === option.id
        option.input.disabled = reasons.length > 0
        option.reason.textContent =
          reasons.length === 0
            ? ''
            : strings.character.blocked({ reason: strings.character.problems[problemKindOf(reasons[0]!)] })
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

const builtInName = (id: string | null): string =>
  (strings.character.names as Readonly<Record<string, string>>)[id ?? ''] ?? id ?? ''

const optionLabel = (slot: SlotId, option: string): string =>
  (strings.character.options[slot] as Readonly<Record<string, string>>)[option] ?? option
