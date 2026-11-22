import type { MemberId } from '@homingbird/protocol'
import {
  type Lifetime,
  type ReadableSignal,
  type Signal,
  h,
  onAnyChange,
  region,
  signal,
} from '@homingbird/ui'
import {
  type PeoplePickerModel,
  type PickerCandidate,
  type PickerOption,
  peoplePickerModel,
  pickerKey,
  withChosen,
} from '../models/people-picker.ts'
import { strings } from '../strings.ts'
import { button, presenceBadges } from './parts.ts'

/**
 * A "To:" field that suggests people as they type: Enter or a click adds the one marked, Backspace in
 * an empty field takes the last one out, and the arrow keys move through the list. A key pressed while
 * an input method composes a word only finishes the word.
 */
export const peoplePicker = (life: Lifetime, spec: PeoplePickerSpec): PeoplePickerParts => {
  const query = signal('')
  const active = signal<MemberId | null>(null)
  const open = signal(false)
  const listId = `${spec.id}-options`
  const model = (): PeoplePickerModel =>
    peoplePickerModel({
      id: spec.id,
      candidates: spec.candidates(),
      chosen: spec.chosen.get(),
      query: query.get(),
      active: active.get(),
      open: open.get(),
      limit: spec.limit,
    })
  const choose = (memberId: MemberId): void => {
    spec.chosen.set(withChosen(spec.chosen.get(), memberId, spec.limit))
    field.value = ''
    query.set('')
    active.set(null)
    open.set(false)
    field.focus()
  }
  const remove = (memberId: MemberId): void => {
    spec.chosen.set(spec.chosen.get().filter((one) => one !== memberId))
    field.focus()
  }
  const field = h('input', {
    id: `${spec.id}-field`,
    type: 'text',
    role: 'combobox',
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'enter',
    placeholder: spec.placeholder,
    'aria-autocomplete': 'list',
    'aria-controls': listId,
    'aria-expanded': 'false',
    on: {
      input: () => {
        query.set(field.value)
        active.set(null)
        open.set(true)
      },
      focus: () => open.set(true),
      blur: () => open.set(false),
      keydown: (event) => {
        const composing = event.isComposing || event.keyCode === IME_KEY_CODE
        const move = pickerKey(event.key, composing, field.value, model())
        if (event.key === 'Enter' && !composing) event.preventDefault()
        if (move.kind === 'none') return
        event.preventDefault()
        if (move.kind === 'move') {
          open.set(true)
          active.set(move.memberId)
        } else if (move.kind === 'choose') choose(move.memberId)
        else if (move.kind === 'remove') remove(move.memberId)
        else open.set(false)
      },
    },
  })
  const sources = [spec.chosen, ...spec.sources]
  const reflect = (): void => {
    const shown = model()
    field.setAttribute('aria-expanded', String(shown.expanded))
    if (shown.activeId === null) field.removeAttribute('aria-activedescendant')
    else field.setAttribute('aria-activedescendant', shown.activeId)
  }
  reflect()
  life.add(onAnyChange([query, active, open, ...sources], reflect))
  const element = h(
    'div',
    { class: 'people-picker' },
    h(
      'div',
      {
        class: 'people-picker-box',
        on: { click: (event) => event.target === event.currentTarget && field.focus() },
      },
      h('label', { class: 'people-picker-label', for: field.id }, spec.label),
      region(life, sources, () => renderChips(model(), remove), { class: 'people-picker-chips-host' }),
      field,
    ),
    region(life, [query, active, open, ...sources], () => renderOptions(model(), listId, choose), {
      class: 'people-picker-options-host',
    }),
    h(
      'p',
      { class: 'visually-hidden', role: 'status' },
      region(life, [query, open, ...sources], () => model().status, { class: 'people-picker-status' }),
    ),
    region(life, sources, () => {
      const full = model().full
      return full !== null && h('p', { class: 'people-picker-full', role: 'note' }, full)
    }),
  )
  return { element, field }
}

export interface PeoplePickerSpec {
  readonly id: string
  readonly label: string
  readonly placeholder: string
  readonly candidates: () => ReadonlyArray<PickerCandidate>
  /** What `candidates` reads, so the picker draws again when it changes. */
  readonly sources: ReadonlyArray<ReadableSignal<unknown>>
  readonly chosen: Signal<ReadonlyArray<MemberId>>
  readonly limit: number | null
}

export interface PeoplePickerParts {
  readonly element: HTMLElement
  readonly field: HTMLInputElement
}

/** The key code a browser reports for a key an input method takes, where `isComposing` is not set yet. */
const IME_KEY_CODE = 229

const renderChips = (model: PeoplePickerModel, remove: (memberId: MemberId) => void): HTMLElement | null =>
  model.chips.length === 0
    ? null
    : h(
        'ul',
        { class: 'people-picker-chips', 'aria-label': strings.picker.chosen },
        model.chips.map((chip) =>
          h(
            'li',
            { class: 'people-picker-chip', data: { memberId: chip.memberId } },
            h('span', {}, chip.name),
            button('✕', () => remove(chip.memberId), { class: 'icon', 'aria-label': chip.removeLabel }),
          ),
        ),
      )

const renderOptions = (
  model: PeoplePickerModel,
  listId: string,
  choose: (memberId: MemberId) => void,
): HTMLElement =>
  h(
    'ul',
    {
      id: listId,
      class: 'people-picker-options',
      role: 'listbox',
      'aria-label': strings.picker.suggestions,
      hidden: !model.expanded,
    },
    model.options.map((option) => renderOption(option, choose)),
  )

const renderOption = (option: PickerOption, choose: (memberId: MemberId) => void): HTMLElement =>
  h(
    'li',
    {
      id: option.id,
      class: `people-picker-option${option.active ? ' is-active' : ''}${option.disabled ? ' is-disabled' : ''}`,
      role: 'option',
      'aria-selected': String(option.active),
      'aria-disabled': option.disabled && 'true',
      data: { memberId: option.memberId },
      on: {
        pointerdown: (event) => event.preventDefault(),
        click: () => {
          if (!option.disabled) choose(option.memberId)
        },
      },
    },
    h(
      'span',
      { class: 'people-picker-who' },
      h('strong', {}, option.name),
      h('span', { class: 'people-picker-email' }, option.email),
    ),
    option.reason === null
      ? presenceBadges(option.presence)
      : h('small', { class: 'people-picker-reason' }, option.reason),
  )
