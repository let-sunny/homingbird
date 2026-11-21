import type { AsRead } from '@homingbird/protocol'
import { type Child, type Properties, h } from '@homingbird/ui'
import { channelLabel } from '../channels.ts'
import type { TimeShown } from '../models/time.ts'
import { presenceShown } from '../presence.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { closesDialog } from './dialog.ts'
import { type PipState, pip } from './pip.ts'

/** A page with a back link, its title and its body. */
export const page = (title: string, ...children: ReadonlyArray<Child>): HTMLElement =>
  h(
    'section',
    { class: 'page' },
    h('header', { class: 'page-head' }, backLink(), h('h1', {}, title)),
    h('div', { class: 'page-body' }, ...children),
  )

export const backLink = (): HTMLElement =>
  h('a', { class: 'back', href: '#/', 'aria-label': strings.back }, '◀')

export const button = (
  label: string,
  onClick: (event: MouseEvent) => void,
  properties: Properties = {},
): HTMLButtonElement => h('button', { type: 'button', ...properties, on: { click: onClick } }, label)

export const field = (label: string, control: HTMLElement, hint?: string): HTMLElement =>
  h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint && h('small', {}, hint),
  )

export const presenceBadges = (presence: AsRead.Presence, inWords = false): HTMLElement => {
  const shown = presenceShown(presence, inWords)
  const personDot = h('span', {
    class: `human-dot ${shown.person.isOn ? 'is-on' : 'is-off'}`,
    role: 'img',
    'aria-label': shown.person.label,
    title: shown.person.label,
  })
  const agent = h(
    'span',
    { class: `agent-light ${shown.agent.isOn ? 'is-on' : 'is-off'}`, title: shown.agent.title },
    shown.agent.words,
  )
  return shown.person.words === null
    ? h('span', { class: 'presence' }, agent, personDot)
    : h(
        'span',
        { class: 'presence is-in-words' },
        h(
          'span',
          { class: `human-state ${shown.person.isOn ? 'is-on' : 'is-off'}` },
          h('span', { class: `human-dot ${shown.person.isOn ? 'is-on' : 'is-off'}`, 'aria-hidden': 'true' }),
          shown.person.words,
        ),
        agent,
      )
}

export const timeLabel = (shown: TimeShown): HTMLElement =>
  h('time', { datetime: shown.datetime, title: shown.title }, shown.text)

/** Shown while a page or a part of one waits for its data. */
export const loading = (): HTMLElement => h('p', { class: 'loading' }, strings.loading)

/** Shown when a page or a part of one could not load its data, with a way to try again. */
export const loadFailed = (retry: () => void): HTMLElement =>
  empty(strings.loadFailed, button(strings.tryAgain, retry))

export const empty = (text: string, ...actions: ReadonlyArray<Child>): HTMLElement =>
  h('div', { class: 'empty' }, h('p', {}, text), ...actions)

/** A page with nothing in it yet: the one place on a page where Pip appears, always at the same size. */
export const emptyWithPip = (state: PipState, text: string, ...actions: ReadonlyArray<Child>): HTMLElement =>
  h('div', { class: 'empty' }, pip(state, EMPTY_PIP_SCALE), h('p', {}, text), ...actions)

export const channelChips = (slugs: ReadonlyArray<string>): HTMLElement =>
  h(
    'ul',
    { class: 'channel-chips' },
    slugs.map((slug) =>
      h(
        'li',
        {},
        h('a', { class: 'channel-chip', href: hrefFor({ name: 'channel', slug }) }, channelLabel(slug)),
      ),
    ),
  )

export const channelCounts = (channel: {
  readonly memberCount: number
  readonly helperCount: number
}): HTMLElement =>
  h(
    'span',
    { class: 'channel-counts' },
    h('span', {}, strings.memberCount({ count: channel.memberCount })),
    h('span', {}, strings.answerCount({ count: channel.helperCount })),
  )

export const archivedMark = (): HTMLElement => h('span', { class: 'archived-mark' }, strings.archived)

export const youMark = (): HTMLElement => h('small', { class: 'is-you' }, strings.youMark)

export const privateMarkOf = (text: string, title?: string): HTMLElement =>
  h(
    'span',
    { class: 'private-mark', ...(title !== undefined && { title }) },
    h('span', { class: 'lock-mark', 'aria-hidden': 'true' }),
    text,
  )

/** A button that cannot be used yet, with the reason beside it, read out with the button. */
export const disabledWithReason = (label: string, reason: string, kind: string): HTMLElement =>
  h(
    'span',
    { class: 'disabled-control' },
    h('button', { type: 'button', class: kind, disabled: true, 'aria-describedby': `${kind}-reason` }, label),
    h('small', { id: `${kind}-reason` }, reason),
  )

/** Cancel, which closes the dialog, beside the dialog's own submit button. */
export const dialogActions = (label: string, kind: 'primary' | 'danger'): HTMLElement =>
  h(
    'div',
    { class: 'dialog-actions' },
    h('button', { type: 'button', ...closesDialog }, strings.cancel),
    h('button', { type: 'submit', class: kind }, label),
  )

const EMPTY_PIP_SCALE = 3
