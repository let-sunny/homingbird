import { type Lifetime, h, region } from '@homingbird/ui'
import {
  type HomeModel,
  type StartInput,
  type StartStep,
  type StartingPoints,
  conversationToRestore,
  homeModel,
  startingPointsModel,
} from '../models/home.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { checking, commandLines, emptyWithPip } from './parts.ts'
import { pip } from './pip.ts'

/** Home, which on a wide screen opens the most recent conversation by itself. */
export const homeView = (context: ViewContext, life: Lifetime): HTMLElement => {
  const { state, page } = context
  const host = region(
    life,
    [state.conversations, state.conversationsLoaded, state.agentCredentials, state.workspace],
    () =>
      renderHome(
        homeModel({
          loaded: state.conversationsLoaded.get(),
          conversations: state.conversations.get(),
          ...startInput(context),
        }),
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
export const startingPoints = (context: StartContext, life: Lifetime): HTMLElement =>
  region(life, [context.state.agentCredentials], () =>
    renderStartingPoints(startingPointsModel(startInput(context)), context),
  )

const renderStartingPoints = (model: StartingPoints, context: StartContext): HTMLElement =>
  h(
    'section',
    { class: 'starting-points', 'aria-labelledby': 'starting-points-title' },
    pip('waving', 3),
    h('h2', { id: 'starting-points-title' }, model.title),
    h(
      'ol',
      {},
      model.steps.map((step) => renderStep(step, context)),
    ),
    h(
      'button',
      { type: 'button', class: 'link take-tour', on: { click: () => context.tour.start() } },
      model.tour,
    ),
  )

const renderStep = (step: StartStep, context: StartContext): HTMLElement =>
  h(
    'li',
    { class: step.done === null ? 'start-step' : 'start-step is-done' },
    h('strong', {}, step.title, step.done !== null && h('span', { class: 'start-step-done' }, step.done)),
    h('p', {}, step.hint),
    step.commands.length > 0 && commandLines(context, step.commands),
    step.links.length > 0 &&
      h(
        'p',
        { class: 'start-step-links' },
        step.links.map((link) =>
          h('a', { class: link.primary ? 'button primary' : 'button', href: link.href }, link.label),
        ),
      ),
  )

const sitsBesideTheList = (host: HTMLElement): boolean =>
  host.isConnected &&
  host.checkVisibility() &&
  host.ownerDocument.querySelector<HTMLElement>('.sidebar')?.checkVisibility() === true

const renderHome = (model: HomeModel, context: StartContext): HTMLElement | null => {
  if (model.kind === 'loading') return checking(context, strings.checking.notes)
  if (model.kind === 'start') return renderStartingPoints(model.start, context)
  return emptyWithPip('waving', model.text)
}

type StartContext = Pick<ViewContext, 'tour' | 'state' | 'page'>

const startInput = (context: StartContext): StartInput => ({
  agentConnected: context.state.agentCredentials.get().length > 0,
  origin: context.page.origin,
})
