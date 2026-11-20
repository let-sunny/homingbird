import type { AsRead, Locale } from '@homingbird/protocol'
import { APPEARANCES, type Appearance } from '../appearance.ts'
import { channelsManagedBy, groupLabel, managesText, teamsOf } from '../groups.ts'
import { languageChoices } from '../languages.ts'
import { hrefFor } from '../routes.ts'
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
  showsGroups: input.groupsOn,
  notifications: input.webPushOn ? (input.pushAvailable ? 'available' : 'unavailable') : null,
})

/** The person's own teams, and the channels whose managers they are; nothing while groups are off. */
export const myGroupsModel = (
  me: AsRead.Me,
  groups: ReadonlyArray<AsRead.Group>,
  loaded: boolean,
  groupsOn: boolean,
): MyGroupsModel | null => {
  if (!groupsOn || !loaded) return null
  const mine = teamsOf(groups, me.member.id)
  const managed = channelsManagedBy(groups, me.member.id)
  return {
    title: strings.groups.yours,
    empty: mine.length === 0 ? strings.groups.yoursNone : null,
    groups: mine.map((group) => ({
      label: groupLabel(group),
      href: hrefFor({ name: 'group', id: group.id }),
    })),
    manages: managesText(managed),
    channels: managed,
  }
}

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
  readonly groupsOn: boolean
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
  readonly showsGroups: boolean
  readonly notifications: 'available' | 'unavailable' | null
}

export interface MyGroupsModel {
  readonly title: string
  readonly empty: string | null
  readonly groups: ReadonlyArray<{ readonly label: string; readonly href: string }>
  /** The channels the person manages, in one sentence and as chips. */
  readonly manages: string
  readonly channels: ReadonlyArray<string>
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
