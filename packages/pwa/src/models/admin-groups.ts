import type { AsRead, MemberId } from '@homingbird/protocol'
import { emailsFromCsv, importPreview } from '../group-import.ts'
import { groupLabel, teamsByLabel } from '../groups.ts'
import { hrefFor } from '../routes.ts'
import type { Workspace } from '../state.ts'
import { listOf, strings } from '../strings.ts'
import type { GroupPageModel } from './group-page.ts'
import { type ListStep, type ListWait, listWaitModel } from './start.ts'

/**
 * Administration → Groups: every team with its members, each opening its editor. A channel's managers are
 * changed with the channel and go when it is archived.
 */
export const adminGroupsModel = (
  groups: ReadonlyArray<AsRead.Group>,
  awaited: ListStep | null,
  workspace: Workspace,
): AdminGroupsModel => {
  if (awaited !== null) return { kind: 'waiting', wait: listWaitModel(awaited, workspace, strings.loading) }
  const teams = teamsByLabel(groups)
  return {
    kind: 'groups',
    create: strings.groups.create,
    empty: teams.length === 0 ? strings.groups.none : null,
    rows: teams.map((group) => {
      const label = groupLabel(group)
      return {
        group,
        label,
        href: hrefFor({ name: 'admin-group', id: group.id }),
        members: strings.memberCount({ count: group.memberIds.length }),
      }
    }),
  }
}

/**
 * Administration → one team: the team's page, which renames it and changes its members where the
 * administrator may, with importing members from a file, deleting it, and the way back to every group.
 */
export const adminGroupModel = (shown: GroupPageModel): AdminGroupModel => {
  const back = { label: strings.groups.backToGroups, href: hrefFor({ name: 'admin', section: 'groups' }) }
  if (shown.kind === 'waiting') return { kind: 'waiting', wait: shown.wait, back }
  if (shown.kind === 'missing') return { kind: 'missing', back }
  return {
    kind: 'group',
    back,
    page: shown,
    importCsv: shown.group.mayAdd ? strings.groups.importCsv : null,
    remove: {
      label: strings.groups.delete,
      title: strings.groups.deleteTitle({ group: shown.title }),
      hint: strings.groups.deleteHint,
    },
  }
}

/**
 * Importing a file into a group: what the pasted or chosen file would change, matched against every
 * member of the organization. The addresses stay in the browser; only member ids are sent.
 */
export const importModel = (input: ImportInput): ImportModel => {
  if (input.members === null) return { kind: 'loading' }
  if (input.typed.trim() === '') return { kind: 'waiting' }
  const named = new Map(input.members.map((member) => [member.id, member.name]))
  const nameOf = (memberId: MemberId): string => named.get(memberId) ?? strings.formerMember
  const preview = importPreview(emailsFromCsv(input.typed), input.members, input.group.memberIds)
  const changes = preview.added.length > 0 || preview.removed.length > 0
  return {
    kind: 'preview',
    memberIds: preview.memberIds,
    adds:
      preview.added.length === 0
        ? null
        : { text: strings.groups.adds({ count: preview.added.length }), names: preview.added.map(nameOf) },
    removes:
      preview.removed.length === 0
        ? null
        : {
            text: strings.groups.removes({ count: preview.removed.length }),
            names: preview.removed.map(nameOf),
          },
    unknown:
      preview.unknown.length === 0 ? null : strings.groups.unknown({ emails: listOf(preview.unknown) }),
    nothing: changes ? null : strings.groups.importNothing,
    mayImport: changes,
  }
}

export type AdminGroupsModel =
  | { readonly kind: 'waiting'; readonly wait: ListWait }
  | {
      readonly kind: 'groups'
      readonly create: string
      readonly empty: string | null
      readonly rows: ReadonlyArray<AdminGroupRow>
    }

export interface AdminGroupRow {
  readonly group: AsRead.Group
  readonly label: string
  readonly href: string
  readonly members: string
}

export type AdminGroupModel =
  | { readonly kind: 'waiting'; readonly wait: ListWait; readonly back: BackLink }
  | { readonly kind: 'missing'; readonly back: BackLink }
  | {
      readonly kind: 'group'
      readonly back: BackLink
      readonly page: Extract<GroupPageModel, { kind: 'group' }>
      readonly importCsv: string | null
      readonly remove: { readonly label: string; readonly title: string; readonly hint: string }
    }

export interface BackLink {
  readonly label: string
  readonly href: string
}

export interface ImportInput {
  readonly typed: string
  readonly members: ReadonlyArray<AsRead.Member> | null
  readonly group: AsRead.Group
}

export type ImportModel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'waiting' }
  | {
      readonly kind: 'preview'
      readonly memberIds: ReadonlyArray<MemberId>
      readonly adds: ImportChange | null
      readonly removes: ImportChange | null
      readonly unknown: string | null
      readonly nothing: string | null
      readonly mayImport: boolean
    }

export interface ImportChange {
  readonly text: string
  readonly names: ReadonlyArray<string>
}
