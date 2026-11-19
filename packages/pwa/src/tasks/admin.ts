import { Task as T } from '@homingbird/kernel'
import type {
  AsRead,
  MemberId,
  MemberStatus,
  OrganizationInsights,
  Role,
  Settings,
} from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { loadPeople } from './workspace.ts'

export const loadSettings: Action<AsRead.Settings> = withApp(({ api }) => api['admin.settings.get']({}))

export const saveSettings = (settings: Settings): Action =>
  withApp(({ api }) => T.asUnit(api['admin.settings.put']({ body: settings })))

export const listMembers: Action<ReadonlyArray<AsRead.Member>> = withApp(({ api }) =>
  T.map((listed: { members: ReadonlyArray<AsRead.Member> }) => listed.members)(api['admin.members.list']({})),
)

export const updateMember = (
  id: MemberId,
  change: { readonly status?: MemberStatus; readonly role?: Role },
): Action => withApp(({ api }) => T.asUnit(api['admin.members.update']({ params: { id }, body: change })))

export const resetMemberCharacter = (memberId: MemberId): Action<AsRead.Member> =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    const member = yield* api['admin.members.resetCharacter']({ params: { id: memberId } })
    yield* loadPeople
    return member
  })

export const loadInsights: Action<OrganizationInsights> = withApp(({ api }) => api['admin.insights']({}))
