import { systemClock } from '@homingbird/kernel'
import type { Presence } from '@homingbird/protocol'
import { type Child, type Properties, h } from '@homingbird/ui'
import { presenceShown } from '../presence.ts'
import { hrefFor } from '../routes.ts'
import { formats, strings } from '../strings.ts'
import { topicLabel } from '../topics.ts'
import { type PipScale, type PipState, pip } from './pip.ts'

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

export const empty = (text: string, ...actions: ReadonlyArray<Child>): HTMLElement =>
  h('div', { class: 'empty' }, h('p', {}, text), ...actions)

export const emptyWithPip = (
  state: PipState,
  scale: PipScale,
  text: string,
  ...actions: ReadonlyArray<Child>
): HTMLElement => h('div', { class: 'empty' }, pip(state, scale), h('p', {}, text), ...actions)

export const topicChips = (slugs: ReadonlyArray<string>): HTMLElement =>
  h(
    'ul',
    { class: 'topic-chips' },
    slugs.map((slug) =>
      h('li', {}, h('a', { class: 'topic-chip', href: hrefFor({ name: 'topic', slug }) }, topicLabel(slug))),
    ),
  )

export const wordmark = (name: string): string => (name === 'Homingbird' ? 'homingbird' : name)
