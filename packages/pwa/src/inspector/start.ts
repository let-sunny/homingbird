import type { Fetch } from '@homingbird/client'
import type { Clock } from '@homingbird/kernel'
import type { Api } from '@homingbird/protocol'
import { h, lifetime, replaceChildren } from '@homingbird/ui'
import type { App } from '../app.ts'
import type { PageDocument } from '../page-document.ts'
import type { AppState } from '../state.ts'
import { locale } from '../strings.ts'
import { type InspectorParts, inspectorPanel } from '../views/inspector.ts'
import { type Recording, createRecording } from './recording.ts'
import { tracedApi } from './traced-api.ts'
import { watchState } from './watched-state.ts'
import { inspectorWords } from './words.ts'

/**
 * Records a page from before its first request, and forgets everything once its session ended. The state
 * is walked here, before anything of a person is in it.
 */
export const startInspector = (parts: {
  readonly clock: Clock
  readonly state: AppState
  readonly makeApi: (fetch: Fetch) => Api
  readonly fetch: Fetch
}): Inspector => {
  const recording = createRecording(parts.clock)
  watchState(parts.state, recording)
  parts.state.session.subscribe((me) => {
    if (me === null) recording.end()
  })
  return {
    recording,
    api: tracedApi(parts.makeApi, parts.fetch, recording),
    show: (app, document, asking) => showPanel(recording, app, document, asking),
  }
}

export interface Inspector {
  readonly recording: Recording
  /** The server's API, recorded. */
  readonly api: Api
  /** Puts the panel on the page. */
  readonly show: (app: Shown, document: Pick<PageDocument, 'addToBody'>, asking: Asking) => void
}

type Shown = Pick<App, 'page' | 'clock' | 'state'>

type Asking = Pick<InspectorParts, 'canAsk' | 'again' | 'invalidate' | 'turnOff'>

/** Drawn again as the session changes, since the language may have changed with it. */
const showPanel = (
  recording: Recording,
  { page, clock, state }: Shown,
  document: Pick<PageDocument, 'addToBody'>,
  asking: Asking,
): void => {
  const host = h('aside', { class: 'inspector-host' })
  let panel: HTMLDetailsElement | null = null
  let life = lifetime()
  const draw = (): void => {
    life.end()
    life = lifetime()
    const isOpen = panel?.hasAttribute('open') ?? false
    const words = inspectorWords(locale)
    panel = inspectorPanel(life, { recording, words, locale, page, clock, ...asking })
    panel.toggleAttribute('open', isOpen)
    host.setAttribute('aria-label', words.title)
    replaceChildren(host, panel)
  }
  draw()
  state.session.subscribe(draw)
  document.addToBody(h('link', { rel: 'stylesheet', href: '/inspector.css' }))
  document.addToBody(host)
}
