import { CHOOSABLE_CHARACTERS, type CharacterSpec, isSameCharacter } from '@homingbird/protocol'
import { SLOTS, type SlotId } from '@homingbird/sprites'
import { PREVIEW_STATES, type Workbench, blockedParts, problemKindOf } from '../characters.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { characterName } from './avatar.ts'

/** "My character": the one in use, the built-ins to pick from, and what picking one offers. */
export const myCharacterModel = (
  current: CharacterSpec,
  picked: CharacterSpec | null,
  hasSaved: boolean,
): MyCharacterModel => ({
  current: strings.character.current({ character: characterName(current) }),
  editorHref: hrefFor(EDITOR),
  mayGoBackToDefault: hasSaved,
  choices: CHOOSABLE_CHARACTERS.map((preset) => ({
    preset,
    name: characterName(preset),
    pressed: picked !== null && preset.id === picked.id,
  })),
  picked:
    picked === null
      ? null
      : {
          spec: picked,
          selected: strings.character.selected({ character: characterName(picked) }),
          mayUse: !(hasSaved && isSameCharacter(picked, current)),
          editHref: hrefFor({ ...EDITOR, from: picked.id }),
        },
})

/** The character on a light and a dark ground, in the states colleagues see most, each named. */
export const previewModel = (spec: CharacterSpec): ReadonlyArray<PreviewGround> =>
  (['light', 'dark'] as const).map((ground) => ({
    ground,
    caption: ground === 'light' ? strings.character.onLight : strings.character.onDark,
    states: PREVIEW_STATES.map((state) => ({
      state,
      word: strings.character.states[state],
      label: `${characterName(spec)}: ${strings.character.states[state]}`,
    })),
  }))

/** Whether the character passes, or the kinds of problem it has, each once. */
export const problemsModel = (problems: ReadonlyArray<string>): ProblemsModel =>
  problems.length === 0
    ? { passes: true, text: strings.character.passes, items: [] }
    : {
        passes: false,
        text: strings.character.problemsTitle,
        items: [...new Set(problems.map(problemKindOf))].map((kind) => strings.character.problems[kind]),
      }

/** What every editor control shows for a workbench: values, what is switched off, and why. */
export const editorControlsModel = (workbench: Workbench): EditorControlsModel => {
  const editor = workbench.editor
  const blocked = blockedParts(workbench)
  return {
    name: editor.name,
    palette: Object.fromEntries(
      (['B', 'D', 'O', 'F', 'K'] as const).map((key) => [key, editor.palette[key].toLowerCase()]),
    ) as Record<'B' | 'D' | 'O' | 'F' | 'K', string>,
    marking: editor.marking.toLowerCase(),
    detail: editor.detail.toLowerCase(),
    eyeAuto: editor.eye === 'auto',
    feet: { checked: editor.feet && editor.parts.under === 'none', disabled: editor.parts.under !== 'none' },
    layer:
      workbench.layer === null
        ? null
        : {
            kept: workbench.layer.kept,
            text:
              workbench.layer.source === 'built-in'
                ? strings.character.layer['built-in']({ character: builtInName(workbench.layer.builtIn) })
                : strings.character.layer[workbench.layer.source],
          },
    parts: Object.fromEntries(
      SLOTS.map((slot) => [
        slot.id,
        slot.options.map((option) => {
          const reasons = blocked[slot.id][option.id]!
          return {
            id: option.id,
            checked: editor.parts[slot.id] === option.id,
            disabled: reasons.length > 0,
            reason:
              reasons.length === 0
                ? ''
                : strings.character.blocked({
                    reason: strings.character.problems[problemKindOf(reasons[0]!)],
                  }),
          }
        }),
      ]),
    ),
  }
}

/** A part's name in the reader's language, or its id when the language has none for it. */
export const optionLabel = (slot: SlotId, option: string): string =>
  (strings.character.options[slot] as Readonly<Record<string, string>>)[option] ?? option

export interface MyCharacterModel {
  readonly current: string
  readonly editorHref: string
  readonly mayGoBackToDefault: boolean
  readonly choices: ReadonlyArray<{
    readonly preset: CharacterSpec
    readonly name: string
    readonly pressed: boolean
  }>
  readonly picked: {
    readonly spec: CharacterSpec
    readonly selected: string
    readonly mayUse: boolean
    readonly editHref: string
  } | null
}

export interface PreviewGround {
  readonly ground: 'light' | 'dark'
  readonly caption: string
  readonly states: ReadonlyArray<{
    readonly state: (typeof PREVIEW_STATES)[number]
    readonly word: string
    readonly label: string
  }>
}

export interface ProblemsModel {
  readonly passes: boolean
  readonly text: string
  readonly items: ReadonlyArray<string>
}

export interface PartChoice {
  readonly id: string
  readonly checked: boolean
  readonly disabled: boolean
  readonly reason: string
}

export interface EditorControlsModel {
  readonly name: string
  readonly palette: Readonly<Record<'B' | 'D' | 'O' | 'F' | 'K', string>>
  readonly marking: string
  readonly detail: string
  readonly eyeAuto: boolean
  readonly feet: { readonly checked: boolean; readonly disabled: boolean }
  readonly layer: { readonly kept: boolean; readonly text: string } | null
  readonly parts: Readonly<Record<string, ReadonlyArray<PartChoice>>>
}

const EDITOR = { name: 'character', draft: null, from: null } as const

const builtInName = (id: string | null): string =>
  (strings.character.names as Readonly<Record<string, string>>)[id ?? ''] ?? id ?? ''
