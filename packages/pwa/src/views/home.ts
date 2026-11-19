import type { Lifetime } from '@homingbird/ui'
import { h, region } from '@homingbird/ui'
import { mayRestoreConversation, mostRecentConversation } from '../home.ts'
import { hrefFor } from '../routes.ts'
import { conversations, conversationsLoaded, openedForThePerson } from '../state.ts'
import { strings } from '../strings.ts'
import { emptyWithPip } from './parts.ts'
import { pip } from './pip.ts'
import { startTour } from './tour.ts'

export const homeView = (life: Lifetime): HTMLElement => {
  const host = region(life, [conversations, conversationsLoaded], () => {
    if (!conversationsLoaded.get()) return h('p', { class: 'loading' }, strings.loading)
    if (conversations.get().length === 0) return startingPoints()
    return emptyWithPip('waving', 6, strings.pickConversation)
  })
  const openMostRecent = (): void => {
    if (!conversationsLoaded.get() || !sitsBesideTheList(host) || !mayRestoreConversation(location.hash))
      return
    const recent = mostRecentConversation(conversations.get())
    if (recent === null) return
    openedForThePerson.set(recent.id)
    location.replace(hrefFor({ name: 'conversation', id: recent.id }))
  }
  life.add(conversations.subscribe(() => requestAnimationFrame(openMostRecent)))
  life.add(conversationsLoaded.subscribe(() => requestAnimationFrame(openMostRecent)))
  requestAnimationFrame(openMostRecent)
  return host
}

export const startingPoints = (): HTMLElement =>
  h(
    'section',
    { class: 'starting-points', 'aria-labelledby': 'starting-points-title' },
    pip('waving', 4),
    h('h2', { id: 'starting-points-title' }, strings.start.title),
    h(
      'ul',
      {},
      start(hrefFor({ name: 'channels' }), strings.start.askChannel, strings.start.askChannelHint),
      start(hrefFor({ name: 'people' }), strings.start.findPerson, strings.start.findPersonHint),
      start(
        hrefFor({ name: 'agent', section: 'connection' }),
        strings.start.connect,
        strings.start.connectHint,
      ),
    ),
    h(
      'button',
      { type: 'button', class: 'link take-tour', on: { click: () => startTour() } },
      strings.start.tour,
    ),
  )

const start = (href: string, label: string, hint: string): HTMLElement =>
  h('li', {}, h('a', { class: 'button', href }, label), h('span', {}, hint))

const sitsBesideTheList = (host: HTMLElement): boolean =>
  host.isConnected &&
  host.checkVisibility() &&
  document.querySelector<HTMLElement>('.sidebar')?.checkVisibility() === true
