import type { AsRead, CharacterSpec } from '@homingbird/protocol'
import type { StateName } from '@homingbird/sprites'
import { builtInIdOf, characterOf } from '../characters.ts'
import { strings } from '../strings.ts'

/** How to show a member's character: which one, in which state, and the words that name it, if any. */
export const memberAvatarOf = (
  member: Pick<AsRead.Member, 'name' | 'character'> | undefined,
  charactersOn: boolean,
  options: Omit<AvatarOptions, 'label'> & { readonly labelled?: boolean } = {},
): AvatarModel => {
  const spec = characterOf(member, charactersOn)
  const label =
    options.labelled === false
      ? null
      : strings.character.avatarLabel({
          person: member?.name ?? strings.formerMember,
          character: characterName(spec),
        })
  return avatarOf(spec, { ...options, label })
}

/** A character with the defaults filled in: still, idle, at twice its size. */
export const avatarOf = (spec: CharacterSpec, options: AvatarOptions = {}): AvatarModel => ({
  spec,
  scale: options.scale ?? 2,
  state: options.state ?? 'idle',
  motion: options.motion ?? 'still',
  settle: options.settle ?? 'idle',
  label: options.label ?? null,
})

/** A built-in character in the reader's language; a made one by the name its maker gave it. */
export const characterName = (spec: CharacterSpec): string => {
  const builtIn = builtInIdOf(spec)
  return builtIn === null
    ? spec.name
    : ((strings.character.names as Readonly<Record<string, string>>)[builtIn] ?? spec.name)
}

/** A group conversation: the first two other people side by side, at the smallest scale. */
export const groupAvatarOf = (
  people: ReadonlyArray<Pick<AsRead.Member, 'name' | 'character'> | undefined>,
  charactersOn: boolean,
): ReadonlyArray<AvatarModel> =>
  people.slice(0, 2).map((person) => memberAvatarOf(person, charactersOn, { scale: 1, labelled: false }))

export type CharacterScale = 1 | 2 | 3 | 4

export type Motion = 'still' | 'once' | 'loop'

export interface AvatarOptions {
  readonly scale?: CharacterScale
  readonly state?: StateName
  readonly motion?: Motion
  readonly settle?: StateName
  readonly label?: string | null
}

export interface AvatarModel {
  readonly spec: CharacterSpec
  readonly scale: CharacterScale
  readonly state: StateName
  readonly motion: Motion
  readonly settle: StateName
  readonly label: string | null
}
