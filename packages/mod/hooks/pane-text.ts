import type { HomingbirdConnection } from '../types'
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
  readonly editThenSend: string
  readonly send: string
  readonly approve: string
  readonly edit: string
  readonly cancel: string
  readonly discard: string
  readonly approveInWebClient: string
  readonly openInWebClient: string
  readonly turnOnApproveButton: string
  readonly approveButtonRisk: string
  readonly turnOnAnyway: string
  readonly turnOffApproveButton: string
}

const PANE_TEXT: Readonly<Record<PaneLanguage, PaneText>> = { en, ko }

const isPaneLanguage = (value: string | null | undefined): value is PaneLanguage =>
  value !== null && value !== undefined && Object.hasOwn(PANE_TEXT, value)
