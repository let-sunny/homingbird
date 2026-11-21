import { Task as T } from '@homingbird/kernel'
import { type AgentCredentialsHeld, FEATURE_NAMES, type MemberId } from '@homingbird/protocol'
import { DEMO_FEATURES } from './account-handlers.ts'
import type { Handlers } from './handlers.ts'
import { organizationInsightsOf } from './insights.ts'
import type { Records, World } from './world.ts'

/** What the administrator's pages read; changing the organization stays with a real server. */
export const adminHandlers = (world: World): Handlers => ({
  'admin.settings.get': () =>
    T.succeed({
      allowedDomains: ['example.com'],
      contactMode: 'open',
      auditRetentionDays: 365,
      answeringFlow: null,
      features: Object.fromEntries(FEATURE_NAMES.map((name) => [name, DEMO_FEATURES.includes(name)])),
    }),
  'admin.members.list': () =>
    T.sync(() => {
      const records = world.records()
      return {
        members: records.members.filter(({ member }) => member.kind === 'person').map(({ member }) => member),
        agents: records.members
          .filter(({ member }) => member.kind === 'channel_agent')
          .map(({ member }) => ({
            member,
            channel: records.channels.find((channel) => channel.agentId === member.id)?.slug ?? null,
          })),
        agentCredentials: agentCredentialsHeld(records, world.clock.now()),
      }
    }),
  'admin.insights': () => T.sync(() => organizationInsightsOf(world.clock.now())),
})

const agentCredentialsHeld = (records: Records, now: number): AgentCredentialsHeld[] => {
  const people = new Set(
    records.members.filter(({ member }) => member.kind === 'person').map(({ member }) => member.id),
  )
  const held = new Map<MemberId, AgentCredentialsHeld>()
  for (const { credential, memberId } of records.credentials) {
    if (credential.kind !== 'agent' || credential.revokedAt !== null || credential.expiresAt <= now) continue
    if (!people.has(memberId)) continue
    const before = held.get(memberId)
    held.set(memberId, {
      memberId,
      count: (before?.count ?? 0) + 1,
      newestExpiresAt: Math.max(before?.newestExpiresAt ?? 0, credential.expiresAt),
    })
  }
  return [...held.values()]
}
