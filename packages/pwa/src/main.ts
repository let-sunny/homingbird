import { type Fetch, httpApi } from '@homingbird/client'
import { systemClock } from '@homingbird/kernel'
import type { Api } from '@homingbird/protocol'
import { createApp } from './app.ts'
import { applyAppearance, currentAppearance } from './appearance.ts'
import { browserPage } from './browser-page.ts'
import { supportInvokerCommands } from './invokers.ts'
import { preferredLanguage } from './languages.ts'
import { browserDocument } from './page-document.ts'
import { guardRestoredPage } from './restored-page.ts'
import { createState } from './state.ts'
import { useLanguage } from './strings.ts'
import { boot } from './tasks/boot.ts'
import { again, invalidate, isResourceKey } from './tasks/resources.ts'
import { showApp } from './views/app-shell.ts'
import { createViewContext } from './views/context.ts'

declare const WITH_INSPECTOR: boolean

const start = (startInspector: typeof import('./inspector/start.ts').startInspector | null): void => {
  const page = browserPage(window)
  const state = createState(location.hash)
  const makeApi = (fetch?: Fetch): Api =>
    httpApi({ serverUrl: location.origin, sendsCookies: true, ...(fetch !== undefined && { fetch }) })
  const inspector =
    WITH_INSPECTOR && startInspector !== null
      ? startInspector({ clock: systemClock, state, makeApi, fetch: (url, init) => fetch(url, init) })
      : null
  const app = createApp(
    {
      clock: systemClock,
      api: inspector?.api ?? makeApi(),
      state,
      page,
      random: {
        id: () => crypto.randomUUID(),
        seed: () => crypto.getRandomValues(new Uint32Array(1))[0]!,
      },
    },
    invalidate('conversations'),
  )
  const pageDocument = browserDocument(() => document)
  const context = createViewContext(app, pageDocument)

  useLanguage(preferredLanguage(undefined, page.languages()))
  applyAppearance(document.documentElement, page.storage, currentAppearance(page.storage))
  supportInvokerCommands(document)
  app.state.branding.subscribe((current) => {
    document.title = current.name
  })
  const root = document.getElementById('app') as HTMLElement
  showApp(context, root, app.launch)
  guardRestoredPage(app, root)
  if (WITH_INSPECTOR)
    inspector?.show(app, pageDocument, {
      canAsk: isResourceKey,
      again: (path) => isResourceKey(path) && app.launch(again(path)),
      invalidate: (path) => isResourceKey(path) && app.launch(invalidate(path)),
      turnOff: toggleInspector,
    })
  app.launch(boot)
  if ('serviceWorker' in navigator)
    void navigator.serviceWorker.register('/service-worker.js').catch(() => {})
}

/** Turns the developers' panel on or off in this browser; the page starts anew, to be recorded from its start. */
const toggleInspector = (): void => {
  const { storage } = browserPage(window)
  if (storage.local('hb-inspector') === null) storage.setLocal('hb-inspector', 'on')
  else storage.removeLocal('hb-inspector')
  location.reload()
}

if (WITH_INSPECTOR) Object.assign(window, { hbInspect: toggleInspector })
if (WITH_INSPECTOR && browserPage(window).storage.local('hb-inspector') !== null)
  void import('./inspector/start.ts').then((inspector) => start(inspector.startInspector))
else start(null)
