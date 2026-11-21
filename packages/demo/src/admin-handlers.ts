import { Task as T } from '@homingbird/kernel'
import { FEATURE_NAMES } from '@homingbird/protocol'
import { DEMO_FEATURES } from './account-handlers.ts'
import type { Handlers } from './handlers.ts'
import { organizationInsightsOf } from './insights.ts'
import type { World } from './world.ts'

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
      }
    }),
  'admin.insights': () => T.sync(() => organizationInsightsOf(world.clock.now())),
})
