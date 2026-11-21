import type { AsRead } from '@homingbird/protocol'
import { type Lifetime, h, later, lifetime, region, replaceChildren } from '@homingbird/ui'
import { track } from '../analytics.ts'
import { NOTICE_MS, toastModel } from '../models/toast.ts'
import { type Route, arrivedToConnect, currentHashFor, parseRoute, signInHref } from '../routes.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { dialogHost } from './dialog.ts'
import { shell } from './shell.ts'
import { signInView } from './sign-in.ts'
import { stageFor } from './stage.ts'

/**
 * Draws the app into its root and keeps it current: loading, signing in, or the shell around the page
 * the route shows. A page reached to connect an agent is shown on its own, without the shell.
 */
export const showApp = (
  context: ViewContext,
  root: HTMLElement,
  launch: (action: ReturnType<typeof track>) => void,
): void => {
  const { state, page } = context
  page.on('hashchange', () => {
    if (replaceOldAddress(context)) return
    inTransition(context, () => state.route.set(parseRoute(page.hash())))
  })
  replaceOldAddress(context)
  const appLife = lifetime()
  let stageLife = lifetime()
  const stage = h('main', { class: 'stage' })
  const drawStage = (me: AsRead.Me): void => {
    stageLife.end()
    stageLife = lifetime()
    replaceChildren(stage, stageFor(context, stageLife, me, state.route.get()))
    launch(track('page_viewed', { page: state.route.get().name }))
  }
  const draw = (): void => {
    appLife.end()
    const me = state.session.get()
    if (me === 'loading') {
      replaceChildren(root, h('p', { class: 'loading boot' }, strings.loading))
      return
    }
    if (me === null && arrivedToConnect(state.route.get())) {
      page.replace(signInHref(page.hash()))
      return
    }
    if (me === null) {
      replaceChildren(root, signInView(context, refusalIn(state.route.get()), inviteIn(state.route.get())))
      appLife.add(state.route.subscribe(draw))
      return
    }
    const focused = arrivedToConnect(state.route.get())
    drawStage(me)
    appLife.add(
      state.route.subscribe(() => {
        if (arrivedToConnect(state.route.get()) === focused) drawStage(me)
        else draw()
        if (!focused) page.nextFrame(() => context.tour.startOnHome(state.route.get().name))
      }),
    )
    if (!focused) page.nextFrame(() => context.tour.startOnHome(state.route.get().name))
    replaceChildren(
      root,
      focused ? stage : shell(context, appLife, me, stage),
      dialogHost(),
      toast(context, appLife),
      liveAnnouncer(context, appLife),
    )
  }
  state.session.subscribe(draw)
  state.serverInfo.subscribe(draw)
  draw()
}

const replaceOldAddress = (context: ViewContext): boolean => {
  const current = currentHashFor(context.page.hash())
  if (current === null) return false
  context.page.replace(current)
  return true
}

const refusalIn = (current: Route): string | null => {
  if (current.name === 'invite-refused') return strings.invites.refused
  return current.name === 'signed-out' ? current.reason : null
}

const inviteIn = (current: Route): string | null => (current.name === 'invite' ? current.code : null)

const toast = (context: ViewContext, life: Lifetime): HTMLElement => {
  const { notice } = context.state
  let cancel = (): void => {}
  life.add(
    notice.subscribe((current) => {
      cancel()
      if (current !== null) cancel = later(context.clock, NOTICE_MS, () => notice.set(null))
    }),
  )
  life.add(() => cancel())
  return region(
    life,
    [notice],
    () => {
      const model = toastModel(notice.get())
      return (
        model !== null &&
        h(
          'div',
          { class: model.className, role: model.role },
          h('span', {}, model.text),
          model.link !== null &&
            h('a', { href: model.link.href, on: { click: () => notice.set(null) } }, model.link.label),
          h(
            'button',
            {
              type: 'button',
              class: 'icon',
              'aria-label': model.close,
              on: { click: () => notice.set(null) },
            },
            '✕',
          ),
        )
      )
    },
    { class: 'toast-host' },
  )
}

const liveAnnouncer = (context: ViewContext, life: Lifetime): HTMLElement =>
  h(
    'div',
    { class: 'visually-hidden', role: 'status' },
    region(life, [context.state.announcement], () => context.state.announcement.get()),
  )

const inTransition = (context: ViewContext, change: () => void): void => {
  if (context.page.prefersReducedMotion() || !context.document.inTransition(change)) change()
}
