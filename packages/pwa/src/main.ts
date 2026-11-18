import type { ConversationId, Me } from '@homingbird/protocol'
import { type Child, type Lifetime, h, lifetime, region, replaceChildren } from '@homingbird/ui'
import { boot, browserLanguages, launch } from './actions.ts'
import { applyAppearance, currentAppearance } from './appearance.ts'
import { supportInvokerCommands } from './invokers.ts'
import { preferredLanguage } from './languages.ts'
import { type Route, parseRoute, signInHref } from './routes.ts'
import { announcement, branding, notice, route, serverInfo, session } from './state.ts'
import { strings, useLanguage } from './strings.ts'
import { credentialsView, profileView } from './views/account.ts'
import { adminView } from './views/admin.ts'
import { consentView, deviceView } from './views/connect.ts'
import { dialogHost } from './views/dialog.ts'
import { emptyWithPip } from './views/parts.ts'
import { peopleView } from './views/people.ts'
import { searchView } from './views/search.ts'
import { shell } from './views/shell.ts'
import { signInView } from './views/sign-in.ts'
import { threadView } from './views/thread-view.ts'
import { topicView, topicsView } from './views/topics.ts'

const start = (root: HTMLElement): void => {
  useLanguage(preferredLanguage(undefined, browserLanguages()))
  applyAppearance(currentAppearance())
  supportInvokerCommands(document)
  addEventListener('hashchange', () => inTransition(() => route.set(parseRoute(location.hash))))
  branding.subscribe((current) => {
    document.title = current.name
  })

  const appLife = lifetime()
  let stageLife = lifetime()
  const stage = h('main', { class: 'stage' })
  const drawStage = (me: Me): void => {
    stageLife.end()
    stageLife = lifetime()
    replaceChildren(stage, stageFor(stageLife, me, route.get()))
  }

  const draw = (): void => {
    appLife.end()
    const me = session.get()
    if (me === 'loading') {
      replaceChildren(root, h('p', { class: 'loading boot' }, strings.loading))
      return
    }
    if (me === null && arrivedToConnect(route.get())) {
      location.replace(signInHref(location.hash))
      return
    }
    if (me === null) {
      replaceChildren(root, signInView(refusalIn(route.get())))
      return
    }
    const focused = arrivedToConnect(route.get())
    drawStage(me)
    appLife.add(route.subscribe(() => (arrivedToConnect(route.get()) === focused ? drawStage(me) : draw())))
    replaceChildren(
      root,
      focused ? stage : shell(appLife, me, stage),
      dialogHost(),
      toast(appLife),
      liveAnnouncer(appLife),
    )
  }
  session.subscribe(draw)
  serverInfo.subscribe(draw)
  draw()
  launch(boot)
  registerServiceWorker()
}

const stageFor = (life: Lifetime, me: Me, current: Route): Child => {
  switch (current.name) {
    case 'home':
      return emptyWithPip(
        'waving',
        6,
        strings.pickConversation,
        h('a', { class: 'button primary', href: '#/people' }, strings.findPeople),
      )
    case 'conversation':
      return threadView(life, me, current.id as ConversationId)
    case 'people':
      return peopleView(life, me)
    case 'topics':
      return topicsView(life)
    case 'topic':
      return topicView(life, current.slug)
    case 'search':
      return searchView(life, me, current.query)
    case 'profile':
      return profileView(life, me)
    case 'credentials':
      return credentialsView(life)
    case 'device':
      return deviceView(life, current.code)
    case 'consent':
      return consentView(life, current.id)
    case 'admin':
      return me.member.role === 'admin' ? adminView(life, me, current.section) : notFound()
    case 'signed-out':
    case 'unknown':
      return notFound()
  }
}

const arrivedToConnect = (current: Route): boolean => current.name === 'device' || current.name === 'consent'

const notFound = (): Child =>
  emptyWithPip('failed', 4, strings.notFound, h('a', { class: 'button', href: '#/' }, strings.backHome))

const refusalIn = (current: Route): string | null => (current.name === 'signed-out' ? current.reason : null)

const NOTICE_MS = 6000

const toast = (life: Lifetime): HTMLElement => {
  let timer: ReturnType<typeof setTimeout> | undefined
  life.add(
    notice.subscribe((current) => {
      clearTimeout(timer)
      if (current !== null) timer = setTimeout(() => notice.set(null), NOTICE_MS)
    }),
  )
  return region(
    life,
    [notice],
    () => {
      const current = notice.get()
      return (
        current !== null &&
        h(
          'div',
          { class: `toast is-${current.kind}`, role: current.kind === 'error' ? 'alert' : 'status' },
          h('span', {}, current.text),
          h(
            'button',
            {
              type: 'button',
              class: 'icon',
              'aria-label': strings.close,
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

const liveAnnouncer = (life: Lifetime): HTMLElement =>
  region(life, [announcement], () => announcement.get(), { class: 'visually-hidden' })

const inTransition = (change: () => void): void => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reducedMotion || !('startViewTransition' in document)) change()
  else document.startViewTransition(change).ready.catch(() => {})
}

const registerServiceWorker = (): void => {
  if ('serviceWorker' in navigator)
    void navigator.serviceWorker.register('/service-worker.js').catch(() => {})
}

start(document.getElementById('app') as HTMLElement)
