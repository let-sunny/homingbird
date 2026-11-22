import type { AsRead } from '@homingbird/protocol'
import {
  type Child,
  type Lifetime,
  type ReadableSignal,
  h,
  onAnyChange,
  region,
  signal,
} from '@homingbird/ui'
import type { NameMatch } from '../models/name-matches.ts'
import { type KeyTarget, shortcutOf, switcherShortcut } from '../models/shortcuts.ts'
import { type SwitcherModel, switcherModel } from '../models/switcher.ts'
import type { Waiting } from '../models/waiting.ts'
import type { ViewContext } from './context.ts'

/**
 * The switcher: a modal dialog with one field over the people, channels and conversations the page
 * already holds. Cmd/Ctrl+K or `/` opens it from anywhere but a text field; the arrow keys choose,
 * Enter or a click goes there, and Escape closes it, as a dialog closes, giving the focus back.
 */
export const switcher = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  waiting: ReadableSignal<Waiting>,
): HTMLDialogElement => {
  const { state } = context
  const query = signal('')
  const chosen = signal(0)
  const open = signal(false)
  const model = (): SwitcherModel =>
    switcherModel({
      query: query.get(),
      chosen: chosen.get(),
      viewerId: me.member.id,
      directory: state.directory.get(),
      channels: state.channels.get(),
      conversations: state.conversations.get(),
      members: state.members.get(),
      waiting: waiting.get().places,
      shortcut: switcherShortcut(context.page.isApple()),
    })
  const sources = [
    open,
    query,
    chosen,
    waiting,
    state.directory,
    state.channels,
    state.conversations,
    state.members,
  ]
  const input = h('input', {
    type: 'text',
    class: 'switcher-input',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': LIST_ID,
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    spellcheck: 'false',
  })
  const dialog = h('dialog', { id: SWITCHER_ID, class: 'switcher' })
  const close = (): void => {
    if (dialog.open) dialog.close()
  }
  const go = (match: NameMatch): void => {
    close()
    if (match.target.kind === 'href') context.page.go(match.target.href)
    else context.actions.openConversationWith(match.target.memberId)
  }
  input.addEventListener('input', () => {
    query.set(input.value)
    chosen.set(0)
  })
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      chosen.update((at) => at + (event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    const match = model().chosen
    if (match !== null) go(match)
  })
  // A dialog's close event comes a task after it closed, so it can arrive after the switcher was opened
  // again at once; the dialog itself says whether it is open.
  dialog.addEventListener('close', () => open.set(dialog.open))
  const describe = (): void => {
    const shown = model()
    input.placeholder = shown.placeholder
    input.setAttribute('aria-label', shown.label)
    dialog.setAttribute('aria-label', shown.title)
    if (shown.chosenId === null) input.removeAttribute('aria-activedescendant')
    else input.setAttribute('aria-activedescendant', shown.chosenId)
    context.page.nextFrame(() =>
      dialog.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }),
    )
  }
  describe()
  life.add(onAnyChange(sources, describe))
  dialog.append(
    input,
    region(life, sources, () => open.get() && renderOptions(model(), go), { class: 'switcher-body' }),
  )
  life.add(
    context.document.listen('keydown', (event) => {
      const press = event as KeyboardEvent
      if (dialog.open) return
      const shortcut = shortcutOf({
        isApple: context.page.isApple(),
        key: press.key,
        metaKey: press.metaKey,
        ctrlKey: press.ctrlKey,
        altKey: press.altKey === true,
        shiftKey: press.shiftKey,
        isComposing: press.isComposing,
        target: keyTargetOf(press.target),
      })
      if (shortcut === null) return
      press.preventDefault()
      input.value = ''
      query.set('')
      chosen.set(0)
      open.set(true)
      dialog.showModal()
      input.focus()
    }),
  )
  return dialog
}

const SWITCHER_ID = 'switcher'

const LIST_ID = 'switcher-options'

const renderOptions = (model: SwitcherModel, go: (match: NameMatch) => void): Child => [
  h(
    'div',
    { id: LIST_ID, class: 'switcher-options', role: 'listbox', 'aria-label': model.label },
    model.sections.map((section) =>
      h(
        'div',
        { class: 'switcher-section', role: 'group', 'aria-labelledby': `${LIST_ID}-${section.key}` },
        h('p', { id: `${LIST_ID}-${section.key}`, class: 'switcher-section-title' }, section.title),
        section.options.map((option) =>
          h(
            'div',
            {
              id: option.id,
              class: `switcher-option is-${option.kind}`,
              role: 'option',
              'aria-selected': String(option.chosen),
              on: {
                click: () => go(option),
                mousedown: (event) => event.preventDefault(),
              },
            },
            h('span', { class: 'switcher-option-label' }, option.label),
            option.detail !== null && h('span', { class: 'switcher-option-detail' }, option.detail),
          ),
        ),
      ),
    ),
  ),
  model.empty !== null && h('p', { class: 'switcher-empty', role: 'status' }, model.empty),
  h('p', { class: 'switcher-foot' }, model.footer),
]

const keyTargetOf = (target: EventTarget | null): KeyTarget | null => {
  if (target === null || !('tagName' in target)) return null
  const element = target as HTMLElement
  return {
    tagName: element.tagName,
    type: element.getAttribute('type') ?? 'text',
    isContentEditable: element.isContentEditable === true,
  }
}
