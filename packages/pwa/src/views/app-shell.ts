import type { AsRead } from '@homingbird/protocol'
import { type Lifetime, h, later, lifetime, region, replaceChildren } from '@homingbird/ui'
import { track } from '../analytics.ts'
import { startModel } from '../models/start.ts'
import { NOTICE_MS, toastModel } from '../models/toast.ts'
import { type Route, arrivedToConnect, currentHashFor, hrefFor, parseRoute, signInHref } from '../routes.ts'
import type { Notice } from '../state.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { DIALOG_ID, dialogHost } from './dialog.ts'
import { heldToast } from './held-toast.ts'
import { button } from './parts.ts'
import { profileCardHost } from './profile-card.ts'
import { shell } from './shell.ts'
import { signInView } from './sign-in.ts'
import { stageFor } from './stage.ts'
import { startView } from './start.ts'

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
  let shownHref: string | null = null
  const drawStage = (me: AsRead.Me): void => {
    stageLife.end()
    stageLife = lifetime()
    const href = hrefFor(state.route.get())
    replaceChildren(stage, stageFor(context, stageLife, me, state.route.get()))
    if (href !== shownHref) stage.scrollTop = 0
    shownHref = href
    launch(track('page_viewed', { page: analyticsPageOf(state.route.get()) }))
  }
  const offerTour = (): void =>
    context.tour.startOnFirstVisit(
      state.route.get().name,
      !state.conversationsLoaded.get() || state.conversations.get().length === 0,
    )
  const draw = (): void => {
    appLife.end()
    stageLife.end()
    const me = state.session.get()
    if (me === 'loading') {
      const model = startModel({
        start: state.start.get(),
        retrying: state.startRetrying.get(),
        brandingName: state.branding.get().name,
        refusal: state.startRefusal.get(),
      })
      replaceChildren(
        root,
        startView(model, () => context.actions.startAgain()),
      )
      appLife.add(state.start.subscribe(draw))
      appLife.add(state.startRetrying.subscribe(draw))
      if (state.start.get() === 'failed') appLife.add(page.on('online', () => context.actions.startAgain()))
      return
    }
    if (me === null) closeWhatIsOpen(context, root)
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
        if (!focused) page.nextFrame(offerTour)
      }),
    )
    if (!focused) {
      appLife.add(state.conversationsLoaded.subscribe(() => page.nextFrame(offerTour)))
      page.nextFrame(offerTour)
    }
    replaceChildren(
      root,
      focused ? stage : shell(context, appLife, me, stage),
      dialogHost(),
      profileCardHost(context, appLife, me),
      toast(context, appLife),
      heldToast(context, appLife),
      liveAnnouncer(context, appLife),
    )
  }
  state.session.subscribe(draw)
  state.serverInfo.subscribe(draw)
  draw()
}

/** Closes the dialog and the popovers, so that what they follow ends with them; removing them alone ends nothing. */
const closeWhatIsOpen = (context: ViewContext, root: HTMLElement): void => {
  context.tour.end()
  const dialog = context.document.byId(DIALOG_ID) as HTMLDialogElement | null
  if (dialog?.open === true) dialog.close()
  for (const popover of root.querySelectorAll<HTMLElement>('[popover]'))
    if (popover.matches(':popover-open')) popover.hidePopover()
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

/**
 * The notice of the moment, closed after a while; one already shown when the page is drawn again gets
 * its time too. While a dialog is open it is shown inside it, since the dialog's backdrop covers the page.
 */
const toast = (context: ViewContext, life: Lifetime): HTMLElement => {
  const { notice } = context.state
  let cancel = (): void => {}
  const time = (current: Notice | null): void => {
    cancel()
    cancel = current === null ? () => {} : later(context.clock, NOTICE_MS, () => notice.set(null))
  }
  time(notice.get())
  life.add(
    notice.subscribe((current) => {
      time(current)
      placeNotice(context, host, current !== null)
    }),
  )
  life.add(() => cancel())
  const host = region(
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
  return host
}

/**
 * Moves the notice into the open dialog while there is one, and back beside it once the dialog closes or
 * new content replaced it there.
 */
const placeNotice = (context: ViewContext, host: HTMLElement, shown: boolean): void => {
  const dialog = context.document.byId(DIALOG_ID) as HTMLDialogElement | null
  if (dialog === null) return
  const putBack = (): void => {
    if (host.parentElement === dialog || !host.isConnected)
      dialog.parentNode?.insertBefore(host, dialog.nextSibling)
  }
  if (!shown || !dialog.open) {
    putBack()
    return
  }
  dialog.append(host)
  dialog.addEventListener('close', putBack, { once: true })
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

/**
 * A group's editor counts as the administration's page, the new-message screen as a conversation's, and
 * a Slack link's page as My agent's, so analytics keeps one value per area.
 */
const analyticsPageOf = (route: Route): Exclude<Route['name'], 'admin-group' | 'new' | 'slack-link'> =>
  route.name === 'admin-group'
    ? 'admin'
    : route.name === 'new'
      ? 'conversation'
      : route.name === 'slack-link'
        ? 'agent'
        : route.name
