import { systemClock } from '@homingbird/kernel'
import type { Channel, Presence } from '@homingbird/protocol'
import { type Child, type Properties, h } from '@homingbird/ui'
import { channelLabel } from '../channels.ts'
import { presenceShown } from '../presence.ts'
import { hrefFor } from '../routes.ts'
import { formats, strings } from '../strings.ts'
import { type PipState, pip } from './pip.ts'

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

export const presenceBadges = (presence: Presence, inWords = false): HTMLElement => {
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

export const timeLabel = (timestamp: number): HTMLElement => {
  const date = new Date(timestamp)
  const sameDay = new Date(systemClock.now()).toDateString() === date.toDateString()
  return h(
    'time',
    { datetime: date.toISOString(), title: formats.full.format(date) },
    (sameDay ? formats.time : formats.day).format(date),
  )
}

export const dateTimeLabel = (timestamp: number | null, fallback: string): string =>
  timestamp === null ? fallback : formats.full.format(new Date(timestamp))

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

export const wordmark = (name: string): string => (name === 'Homingbird' ? 'homingbird' : name)

export const channelCounts = (channel: Pick<Channel, 'memberCount' | 'helperCount'>): HTMLElement =>
  h(
    'span',
    { class: 'channel-counts' },
    h('span', {}, strings.memberCount({ count: channel.memberCount })),
    h('span', {}, strings.answerCount({ count: channel.helperCount })),
  )

export const archivedMark = (): HTMLElement => h('span', { class: 'archived-mark' }, strings.archived)

export const youMark = (): HTMLElement => h('small', { class: 'is-you' }, strings.youMark)

const EMPTY_PIP_SCALE = 3
