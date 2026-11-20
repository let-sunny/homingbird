import { type Lifetime, h, region } from '@homingbird/ui'
import {
  type HomeModel,
  type StartingPoints,
  conversationToRestore,
  homeModel,
  startingPointsModel,
} from '../models/home.ts'
import { hrefFor } from '../routes.ts'
import type { ViewContext } from './context.ts'
import { emptyWithPip, loading } from './parts.ts'
import { pip } from './pip.ts'

/** Home, which on a wide screen opens the most recent conversation by itself. */
export const homeView = (context: ViewContext, life: Lifetime): HTMLElement => {
  const { state, page } = context
  const host = region(life, [state.conversations, state.conversationsLoaded], () =>
    renderHome(
      homeModel({ loaded: state.conversationsLoaded.get(), conversations: state.conversations.get() }),
      context,
    ),
  )
  const openMostRecent = (): void => {
    const recent = conversationToRestore({
      loaded: state.conversationsLoaded.get(),
      conversations: state.conversations.get(),
      besideTheList: sitsBesideTheList(host),
      hash: page.hash(),
    })
    if (recent === null) return
    state.openedForThePerson.set(recent)
    page.replace(hrefFor({ name: 'conversation', id: recent, draft: null }))
  }
  life.add(state.conversations.subscribe(() => page.nextFrame(openMostRecent)))
  life.add(state.conversationsLoaded.subscribe(() => page.nextFrame(openMostRecent)))
  page.nextFrame(openMostRecent)
  return host
}

/** Where to begin, also shown in the sidebar while there is no conversation yet. */
export const startingPoints = (context: Pick<ViewContext, 'tour'>): HTMLElement =>
  renderStartingPoints(startingPointsModel(), context)

const renderStartingPoints = (model: StartingPoints, context: Pick<ViewContext, 'tour'>): HTMLElement =>
  h(
    'section',
    { class: 'starting-points', 'aria-labelledby': 'starting-points-title' },
    pip('waving', 3),
    h('h2', { id: 'starting-points-title' }, model.title),
    h(
      'ul',
      {},
      model.points.map((point) =>
        h('li', {}, h('a', { class: 'button', href: point.href }, point.label), h('span', {}, point.hint)),
      ),
    ),
    h(
      'button',
      { type: 'button', class: 'link take-tour', on: { click: () => context.tour.start() } },
      model.tour,
    ),
  )

const sitsBesideTheList = (host: HTMLElement): boolean =>
  host.isConnected &&
  host.checkVisibility() &&
  host.ownerDocument.querySelector<HTMLElement>('.sidebar')?.checkVisibility() === true

const renderHome = (model: HomeModel, context: Pick<ViewContext, 'tour'>): HTMLElement => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'start') return renderStartingPoints(model.start, context)
  return emptyWithPip('waving', model.text)
}
