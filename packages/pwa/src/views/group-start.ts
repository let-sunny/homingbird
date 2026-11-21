import type { MemberId } from '@homingbird/protocol'
import { h } from '@homingbird/ui'
import type { ChoiceToggle, GroupStartModel } from '../models/group-start.ts'
import { button } from './parts.ts'

/** Above the people list: who is chosen, each removable, and the button that starts the conversation. */
export const groupStartPanel = (
  model: GroupStartModel | null,
  handlers: GroupStartHandlers,
): HTMLElement | null =>
  model === null
    ? null
    : model.collapsed !== null
      ? h(
          'section',
          { class: 'group-start is-collapsed', 'aria-labelledby': TITLE_ID },
          h(
            'div',
            { class: 'group-start-head' },
            h('h2', { id: TITLE_ID }, model.title),
            h('span', { class: 'group-start-count' }, model.collapsed),
          ),
        )
      : h(
          'section',
          { class: 'group-start', 'aria-labelledby': TITLE_ID },
          h(
            'div',
            { class: 'group-start-head' },
            h('h2', { id: TITLE_ID }, model.title),
            h('span', { class: 'group-start-count' }, model.count),
          ),
          h('p', { class: 'group-start-intro' }, model.intro),
          model.chips.length > 0 &&
            h(
              'ul',
              { class: 'group-start-chips' },
              model.chips.map((chip) =>
                h(
                  'li',
                  { class: 'group-start-chip' },
                  h('span', {}, chip.name),
                  button('✕', () => handlers.remove(chip.memberId), {
                    class: 'icon',
                    'aria-label': chip.removeLabel,
                  }),
                ),
              ),
            ),
          h('p', { class: 'group-start-status', role: 'status' }, model.status),
          model.full !== null && h('p', { class: 'group-start-full', role: 'note' }, model.full),
          model.existing !== null &&
            h('p', { class: 'group-start-existing', role: 'note' }, model.existing.text),
          h(
            'div',
            { class: 'group-start-actions' },
            model.existing === null
              ? button(model.start.label, handlers.start, {
                  class: 'primary',
                  disabled: !model.start.enabled,
                })
              : h('a', { class: 'button primary', href: model.existing.href }, model.existing.label),
            model.clear !== null && button(model.clear, handlers.clear, { class: 'link' }),
          ),
        )

/** The button on a person's card that adds them to, or takes them out of, the conversation being started. */
export const choiceToggle = (memberId: MemberId, toggle: ChoiceToggle, onToggle: () => void): HTMLElement =>
  reflectedToggle(
    button(toggle.text, onToggle, { class: 'choose-toggle', data: { chooses: memberId } }),
    toggle,
  )

/** Brings every choice toggle under the host up to date without drawing the list again, so focus stays put. */
export const reflectChoices = (host: ParentNode, toggles: ReadonlyMap<MemberId, ChoiceToggle>): void => {
  for (const control of host.querySelectorAll<HTMLButtonElement>('.choose-toggle')) {
    const toggle = toggles.get(control.getAttribute('data-chooses') as MemberId)
    if (toggle !== undefined) reflectedToggle(control, toggle)
  }
}

export interface GroupStartHandlers {
  readonly remove: (memberId: MemberId) => void
  readonly clear: () => void
  readonly start: () => void
}

const TITLE_ID = 'group-start-title'

const reflectedToggle = (control: HTMLButtonElement, toggle: ChoiceToggle): HTMLButtonElement => {
  control.textContent = toggle.text
  control.setAttribute('aria-label', toggle.label)
  control.setAttribute('aria-pressed', String(toggle.pressed))
  control.disabled = toggle.disabled
  return control
}
