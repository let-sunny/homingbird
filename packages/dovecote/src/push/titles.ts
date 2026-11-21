import { DEFAULT_LOCALE, type DeskUnavailableKind, type Locale } from '@homingbird/protocol'
import { en } from './titles/en.ts'
import { ko } from './titles/ko.ts'

export const pushTitlesIn = (locale: Locale | null): PushTitles => PUSH_TITLES[locale ?? DEFAULT_LOCALE]

export interface PushTitles {
  readonly noteFrom: (author: string) => string
  readonly noteFromColleague: string
  readonly draftWaiting: string
  readonly reviewWaiting: (channel: string) => string
  readonly test: string
  readonly testBody: string
  readonly deskStopped: string
  readonly deskStoppedBody: string
  readonly deskUnavailable: string
  readonly deskUnavailableBody: Readonly<Record<DeskUnavailableKind, string>>
}

const PUSH_TITLES: Readonly<Record<Locale, PushTitles>> = { en, ko }
