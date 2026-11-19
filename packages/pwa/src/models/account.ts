import type { AsRead, Locale } from '@homingbird/protocol'
import { APPEARANCES, type Appearance } from '../appearance.ts'
import { languageChoices } from '../languages.ts'
import { strings } from '../strings.ts'

/** Profile: the person's name and about text, how the page looks, its language, and notifications. */
export const profileModel = (input: ProfileInput): ProfileModel => ({
  email: input.me.member.email,
  name: input.me.member.name,
  profile: input.me.member.profile,
  appearances: APPEARANCES.map((appearance) => ({
    value: appearance,
    label: APPEARANCE_LABELS[appearance](),
    checked: input.appearance === appearance,
  })),
  languages: languageChoicesFor(input.me),
  showsCharacter: input.charactersOn,
  notifications: input.webPushOn ? (input.pushAvailable ? 'available' : 'unavailable') : null,
})

/** The languages to choose from, the one chosen checked; none chosen follows the browser. */
export const languageChoicesFor = (me: Pick<AsRead.Me, 'locale'>): ReadonlyArray<LanguageOption> =>
  languageChoices(strings.languageAuto).map((choice) => ({
    value: choice.value,
    label: choice.label,
    lang: choice.lang,
    checked: (me.locale ?? null) === choice.value,
  }))

/** The notifications switch: on or off, busy while the browser asks, and the test's outcome. */
export const notificationsModel = (input: {
  readonly isOn: boolean
  readonly isBusy: boolean
  readonly tested: ReadonlyArray<string>
}): NotificationsModel => ({
  checked: input.isOn,
  disabled: input.isBusy,
  mayTest: input.isOn,
  results: input.tested,
})

export interface ProfileInput {
  readonly me: AsRead.Me
  readonly appearance: Appearance
  readonly charactersOn: boolean
  readonly webPushOn: boolean
  readonly pushAvailable: boolean
}

export interface ProfileModel {
  readonly email: string
  readonly name: string
  readonly profile: string
  readonly appearances: ReadonlyArray<{
    readonly value: Appearance
    readonly label: string
    readonly checked: boolean
  }>
  readonly languages: ReadonlyArray<LanguageOption>
  readonly showsCharacter: boolean
  readonly notifications: 'available' | 'unavailable' | null
}

export interface LanguageOption {
  readonly value: Locale | null
  readonly label: string
  readonly lang: Locale | null
  readonly checked: boolean
}

export interface NotificationsModel {
  readonly checked: boolean
  readonly disabled: boolean
  readonly mayTest: boolean
  readonly results: ReadonlyArray<string>
}

const APPEARANCE_LABELS: Readonly<Record<Appearance, () => string>> = {
  auto: () => strings.appearanceAuto,
  light: () => strings.appearanceLight,
  dark: () => strings.appearanceDark,
}
