import { httpApi } from '@homingbird/client'
import { systemClock } from '@homingbird/kernel'
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
import { loadConversations } from './tasks/workspace.ts'
import { showApp } from './views/app-shell.ts'
import { createViewContext } from './views/context.ts'

const page = browserPage(window)
const app = createApp(
  {
    clock: systemClock,
    api: httpApi({ serverUrl: location.origin, sendsCookies: true }),
    state: createState(location.hash),
    page,
    random: {
      id: () => crypto.randomUUID(),
      seed: () => crypto.getRandomValues(new Uint32Array(1))[0]!,
    },
  },
  loadConversations,
)
const context = createViewContext(
  app,
  browserDocument(() => document),
)

useLanguage(preferredLanguage(undefined, page.languages()))
applyAppearance(document.documentElement, page.storage, currentAppearance(page.storage))
supportInvokerCommands(document)
app.state.branding.subscribe((current) => {
  document.title = current.name
})
const root = document.getElementById('app') as HTMLElement
showApp(context, root, app.launch)
guardRestoredPage(app, root)
app.launch(boot)
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/service-worker.js').catch(() => {})
