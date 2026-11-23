import { DEFAULT_LOCALE, type DeskUnavailableKind, type Locale } from '@homingbird/protocol'
import { en } from './titles/en.ts'
import { ko } from './titles/ko.ts'

export const pushTitlesIn = (locale: Locale | null): PushTitles => PUSH_TITLES[locale ?? DEFAULT_LOCALE]

export interface PushTitles {
  readonly noteFrom: (author: string) => string
  readonly noteFromColleague: string
  readonly draftWaiting: string
  readonly reviewWaiting: (channel: string) => string
  readonly notPosted: (channel: string) => string
  readonly test: string
  readonly testBody: string
  readonly deskStopped: string
  readonly deskStoppedBody: string
  readonly deskUnavailable: string
  readonly deskUnavailableBody: Readonly<Record<DeskUnavailableKind, string>>
  readonly meeting: MeetingPushTitles
}

/** A scheduling flock's meeting, titled by the flock and, when it is about someone else, their name. */
export interface MeetingPushTitles {
  readonly colleague: string
  readonly waits: (room: string) => string
  readonly waitsBody: { readonly send: string; readonly add: string }
  readonly added: (room: string) => string
  readonly addedBody: string
  readonly cancelled: (room: string) => string
  readonly cancelledBody: string
  readonly busy: (room: string, person: string) => string
  readonly busyBody: string
  readonly left: (room: string, person: string) => string
  readonly leftBody: { readonly took_out: string; readonly declined: string }
  readonly removeByHand: (room: string) => string
  readonly removeByHandBody: string
  readonly joined: (room: string) => string
  readonly joinedBody: string
  readonly joinedFirstBody: (agent: string) => string
}

const PUSH_TITLES: Readonly<Record<Locale, PushTitles>> = { en, ko }
