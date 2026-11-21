import { httpApi } from '@homingbird/client'
import { createApp } from '@homingbird/pwa/src/app.ts'
import { applyAppearance, currentAppearance } from '@homingbird/pwa/src/appearance.ts'
import { browserPage } from '@homingbird/pwa/src/browser-page.ts'
import { supportInvokerCommands } from '@homingbird/pwa/src/invokers.ts'
import { preferredLanguage } from '@homingbird/pwa/src/languages.ts'
import { browserDocument } from '@homingbird/pwa/src/page-document.ts'
import { createState } from '@homingbird/pwa/src/state.ts'
import { useLanguage } from '@homingbird/pwa/src/strings.ts'
import { boot } from '@homingbird/pwa/src/tasks/boot.ts'
import { loadConversations } from '@homingbird/pwa/src/tasks/workspace.ts'
import { showApp } from '@homingbird/pwa/src/views/app-shell.ts'
import { createViewContext } from '@homingbird/pwa/src/views/context.ts'
import { demoPage } from './demo-page.ts'
import { DEMO_TOOLS, demoReadsOf } from './demo-tools.ts'
import { fakeDovecote } from './dovecote.ts'
import { clockFor, demoOptions } from './options.ts'
import { VISITOR_ID } from './team.ts'
import { modelContextOf, offerDemoTools } from './web-mcp.ts'
import { createWorld } from './world.ts'

const options = demoOptions(location.search)
const clock = clockFor(options)
const dovecote = fakeDovecote(createWorld(clock))
const api = httpApi({ serverUrl: location.origin, fetch: dovecote })
const page = demoPage(browserPage(window), dovecote, () => location.reload(), options)
let draws = 0
const app = createApp(
  {
    clock,
    api,
    state: createState(location.hash),
    page,
    random:
      options.at === null
        ? { id: () => crypto.randomUUID(), seed: () => crypto.getRandomValues(new Uint32Array(1))[0]! }
        : { id: () => `demo-page-${++draws}`, seed: () => ++draws },
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
  document.title = `${current.name} demo`
})
showApp(context, document.getElementById('app') as HTMLElement, app.launch)
app.launch(boot)
offerDemoTools(
  modelContextOf(window),
  DEMO_TOOLS,
  {
    api,
    viewerId: VISITOR_ID,
    nonce: () => Array.from(crypto.getRandomValues(new Uint8Array(16)), hex).join(''),
  },
  new AbortController().signal,
)

function hex(byte: number): string {
  return byte.toString(16).padStart(2, '0')
}
