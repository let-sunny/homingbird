import { USUAL_LOAD_SECONDS } from '../load-timing.ts'
import type { Load } from '../resource.ts'
import type { Start, Workspace } from '../state.ts'
import { strings } from '../strings.ts'
import type { PipState } from '../views/pip.ts'

/** What the page shows before the person's session is known: a quiet wait, or a way to try again. */
export const startModel = (input: StartInput): StartModel => {
  const { start, retrying, brandingName } = input
  if (start === 'refused') return retryPage(brandingName, 'offline', input.refusal)
  if (start === 'failed') return retryPage(brandingName, 'offline', strings.firstLoad.failed)
  if (start === 'long') return retryPage(brandingName, 'connecting', strings.firstLoad.tooLong)
  return { kind: 'loading', text: waitingWords(start, retrying) }
}

/**
 * The line above the lists while the workspace has not loaded: nothing while it loads as usual or once it
 * is loaded, a quiet note when it is slower than usual, and the way to try again when it took too long or failed.
 */
export const workspaceLineModel = (workspace: Workspace, refusal: string): WorkspaceLine | null => {
  if (workspace === 'slow') return { text: waitingWords('slow', false), retry: null }
  if (workspace === 'long') return { text: strings.firstLoad.tooLong, retry: strings.tryAgain }
  if (workspace === 'failed')
    return { text: refusal === '' ? strings.firstLoad.failed : refusal, retry: strings.tryAgain }
  return null
}

/** What an empty list says while its data has not come: that it is checking, or nothing once the line speaks. */
export const checkingWords = (workspace: Workspace, words: string): string | null =>
  workspace === 'loading' || workspace === 'slow' ? words : null

/**
 * What stands in place of a list that has not come: that it is checking, then, once it took too long or
 * failed, the way to try again. Never "none", and nothing while the line above the lists offers to try again,
 * so the page says it once.
 */
export const listWaitModel = (step: ListStep, workspace: Workspace, words: string): ListWait => {
  if (isToldAbove(workspace)) return { kind: 'told-above' }
  if (step === 'long') return { kind: 'long', text: strings.firstLoad.tooLong, retry: strings.tryAgain }
  if (step === 'failed') return { kind: 'failed', text: strings.loadFailed, retry: strings.tryAgain }
  return { kind: 'checking', text: words }
}

/** The step of lists whose first answers are waited for together, or null once each has come. */
export const firstAnswersStep = (loads: ReadonlyArray<Load>): ListStep | null => {
  const awaited = loads.filter((load) => !load.loaded)
  if (awaited.length === 0) return null
  if (awaited.some((load) => load.step === 'failed')) return 'failed'
  return awaited.some((load) => load.step === 'long') ? 'long' : 'loading'
}

/** Whether the line above the lists says the load is slow or failed, so that no list says it again. */
const isToldAbove = (workspace: Workspace): boolean => workspace === 'long' || workspace === 'failed'

/** A list's first answer: still awaited, awaited too long, or not coming. */
export type ListStep = 'loading' | 'long' | 'failed'

export type ListWait =
  | { readonly kind: 'told-above' }
  | { readonly kind: 'checking'; readonly text: string }
  | { readonly kind: 'long' | 'failed'; readonly text: string; readonly retry: string }

export interface StartInput {
  readonly start: Start
  readonly retrying: boolean
  readonly brandingName: string
  readonly refusal: string
}

export type StartModel =
  | { readonly kind: 'loading'; readonly text: string }
  | {
      readonly kind: 'retry'
      readonly title: string
      readonly pip: PipState
      readonly text: string
      readonly retry: string
    }

export interface WorkspaceLine {
  readonly text: string
  readonly retry: string | null
}

const waitingWords = (start: Start | Workspace, retrying: boolean): string => {
  if (retrying) return strings.firstLoad.retrying
  return start === 'slow' ? strings.firstLoad.usually({ count: USUAL_LOAD_SECONDS }) : strings.loading
}

const retryPage = (title: string, pip: PipState, text: string): StartModel => ({
  kind: 'retry',
  title,
  pip,
  text,
  retry: strings.tryAgain,
})
