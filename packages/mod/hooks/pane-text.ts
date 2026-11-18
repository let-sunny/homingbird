import type { EngineInterface } from 'claude-code'

import type { HomingbirdConnection, HomingbirdOverview } from '../types'
import { en } from './pane-text/en'
import { ko } from './pane-text/ko'

export type PaneLanguage = 'en' | 'ko'

export const paneTextIn = (language: PaneLanguage): PaneText => PANE_TEXT[language]

export const paneLanguageFrom = (
  chosen: string | null | undefined,
  environment: ReadonlyArray<string | undefined>,
): PaneLanguage => {
  if (isPaneLanguage(chosen)) return chosen
  const setting = environment.find((value) => value !== undefined && value !== '')
  const primary = setting?.split(/[-_.@]/)[0]?.toLowerCase()
  return isPaneLanguage(primary) ? primary : 'en'
}

/** The person's language for the pane, the status line, toasts and notifications. */
export async function textFor($: EngineInterface, latest: HomingbirdOverview | null): Promise<PaneText> {
  const environment = [await $.env.get('LC_ALL'), await $.env.get('LC_MESSAGES'), await $.env.get('LANG')]
  return paneTextIn(paneLanguageFrom(latest?.locale, environment))
}

export interface PaneText {
  readonly connection: Readonly<Record<HomingbirdConnection, string>>
  readonly waiting: (count: number) => string
  readonly keepOpen: string
  readonly moved: string
  readonly becomeDesk: string
  readonly confirmSignIn: string
  readonly openSignInPage: string
  readonly signInCode: (code: string) => string
  readonly signInPrompt: string
  readonly serverUrl: string
  readonly signIn: string
  readonly memberOn: (member: string, server: string) => string
  readonly draftsWaiting: string
  readonly none: string
  readonly noneYet: string
  readonly notesWaiting: string
  readonly draftReady: string
  readonly drafting: string
  readonly askedForDraft: string
  readonly askedForDraftWith: (instruction: string) => string
  readonly conversations: string
  readonly unread: (count: number) => string
  readonly newNote: string
  readonly reply: string
  readonly newNoteBy: (agent: string) => string
  readonly replyBy: (agent: string) => string
  readonly approveInWebClient: string
  readonly awaitingYourApproval: string
  readonly openInWebClient: string
  readonly deskStatus: (waiting: number) => string
  readonly toast: (text: string) => string
  readonly noteArrived: (author: string) => string
  readonly aColleague: string
  readonly draftReadyNotice: string
  readonly draftingRequest: string
  readonly streamStopped: string
  readonly couldNotSignIn: (reason: string) => string
  readonly noNode: (olderVersion: string | null) => string
  readonly serverHeading: string
  readonly serverHelp: string
  readonly serverByCommand: string
  readonly checkingServer: string
  readonly useServer: string
  readonly serverRefused: (reason: 'not-https' | 'unreachable' | 'not-homingbird', typed: string) => string
  readonly changeServer: string
  readonly serverUsuallySet: string
  readonly signInTo: (host: string) => string
  readonly openWeb: string
  readonly signOut: string
  readonly deskStopped: (
    before: Pick<HomingbirdOverview, 'memberName' | 'server'>,
    after: Pick<HomingbirdOverview, 'memberName' | 'server'> | null,
  ) => string
  readonly hostTooOld: string
  readonly waitingForApproval: string
  readonly signInDenied: string
  readonly signInExpired: string
  readonly signInUnreachable: string
  readonly tryAgain: string
  readonly characterStarted: string
}

const PANE_TEXT: Readonly<Record<PaneLanguage, PaneText>> = { en, ko }

const isPaneLanguage = (value: string | null | undefined): value is PaneLanguage =>
  value !== null && value !== undefined && Object.hasOwn(PANE_TEXT, value)
