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
import { reread } from './resources.ts'

export const loadSettings: Action<AsRead.Settings> = withApp(({ api }) => api['admin.settings.get']({}))

/** Saves the settings, then reads the server's features again so a switch shows on this page at once. */
export const saveSettings = (settings: Settings): Action =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    yield* api['admin.settings.put']({ body: settings })
    const info = yield* T.result(api['server.info']({}))
    if (info._tag === 'Ok') state.serverInfo.set(info.value)
  })

/** Every person, with the agent credentials each holds; null credentials from a server that does not say. */
export const listMembers: Action<MemberListing> = withApp(({ api }) =>
  T.map(
    (listed: {
      members: ReadonlyArray<AsRead.Member>
      agentCredentials?: ReadonlyArray<AsRead.AgentCredentialsHeld> | undefined
    }): MemberListing => ({ members: listed.members, agentCredentials: listed.agentCredentials ?? null }),
  )(api['admin.members.list']({})),
)

export interface MemberListing {
  readonly members: ReadonlyArray<AsRead.Member>
  readonly agentCredentials: ReadonlyArray<AsRead.AgentCredentialsHeld> | null
}

export const updateMember = (
  id: MemberId,
  change: { readonly status?: MemberStatus; readonly role?: Role },
): Action => withApp(({ api }) => T.asUnit(api['admin.members.update']({ params: { id }, body: change })))

export const resetMemberCharacter = (memberId: MemberId): Action<AsRead.Member> =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    const member = yield* api['admin.members.resetCharacter']({ params: { id: memberId } })
    yield* reread('directory', 'contacts')
    return member
  })

export const loadInsights: Action<OrganizationInsights> = withApp(({ api }) => api['admin.insights']({}))
