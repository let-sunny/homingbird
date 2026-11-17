import { systemClock } from '@homingbird/kernel'
import type { Presence } from '@homingbird/protocol'
import { type Child, type Properties, h } from '@homingbird/ui'
import { strings } from '../strings.ts'
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

export const presenceBadges = (presence: Presence, detailed = false): HTMLElement =>
  h(
    'span',
    { class: 'presence' },
    h(
      'span',
      {
        class: `agent-light ${presence.agentOnline ? 'is-on' : 'is-off'}`,
        title: presence.agentOnline ? strings.agentOnlineHint : strings.agentOffline,
      },
      presence.agentOnline ? strings.agentOnline : detailed ? strings.agentOffline : null,
    ),
    h('span', {
      class: `human-dot ${presence.humanOnline ? 'is-on' : 'is-off'}`,
      role: 'img',
      'aria-label': presence.humanOnline ? strings.humanOnline : strings.humanOffline,
      title: presence.humanOnline ? strings.humanOnline : strings.humanOffline,
    }),
  )

export const timeLabel = (timestamp: number): HTMLElement => {
  const date = new Date(timestamp)
  const sameDay = new Date(systemClock.now()).toDateString() === date.toDateString()
  return h(
    'time',
    { datetime: date.toISOString(), title: FULL.format(date) },
    (sameDay ? TIME : DAY).format(date),
  )
}

export const dateTimeLabel = (timestamp: number | null, fallback: string): string =>
  timestamp === null ? fallback : FULL.format(new Date(timestamp))

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')

export const avatar = (name: string): HTMLElement =>
  h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(name))

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
      h('li', {}, h('a', { class: 'topic-chip', href: `#/t/${encodeURIComponent(slug)}` }, `#${slug}`)),
    ),
  )

export const wordmark = (name: string): string => (name === 'Homingbird' ? 'homingbird' : name)

const TIME = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const FULL = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })
