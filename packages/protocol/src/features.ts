import { Schema as S } from '@homingbird/kernel'
import type { RouteName } from './contract.ts'

/** Optional features, their defaults and routes. Notes, drafts, approval, sign-in and audit have no switch. */
export const FEATURES = {
  channels: { default: true, routes: ['channels.create'] },
  groups: {
    default: true,
    routes: [
      'groups.list',
      'groups.get',
      'groups.rename',
      'groups.members.set',
      'channels.managers.addTeam',
      'admin.groups.create',
      'admin.groups.delete',
    ],
  },
  draftRequests: {
    default: true,
    routes: ['draftRequests.create', 'draftRequests.cancel', 'draftRequests.list'],
  },
  characters: {
    default: true,
    routes: ['me.character.set', 'me.character.clear', 'admin.members.resetCharacter'],
  },
  mute: {
    default: true,
    routes: ['conversations.mute', 'conversations.unmute', 'me.notifications.set'],
  },
  webPush: { default: true, routes: ['push.key', 'push.subscribe', 'push.test', 'push.unsubscribe'] },
  answeringFlow: { default: true, routes: ['answeringFlow.get'] },
  teaching: {
    default: true,
    routes: [
      'principles.list',
      'principles.create',
      'principles.update',
      'principles.reorder',
      'principles.delete',
      'principles.miss',
      'principles.offers.dismiss',
      'principles.drafting',
    ],
  },
  agentFigures: { default: true, routes: ['insights.mine'] },
  routeMap: { default: true, routes: [] },
  insights: { default: true, routes: ['admin.insights'] },
  noteDetails: { default: true, routes: [] },
  debateRooms: {
    default: true,
    routes: [
      'debates.list',
      'debates.waiting',
      'debates.get',
      'debates.create',
      'debates.optIn',
      'debates.limits.set',
      'debates.turns.post',
      'debates.result.draft',
      'debates.result.vote',
      'debates.result.post',
      'debates.export',
    ],
  },
  channelAgents: {
    default: false,
    routes: [
      'channels.agent.get',
      'channels.agent.create',
      'channels.agent.rename',
      'channels.agent.retire',
      'channels.agent.credentials.revoke',
      'channels.askPrivately',
      'reviews.list',
      'reviews.get',
    ],
  },
  analytics: { default: false, routes: ['analytics.track'] },
} as const satisfies Readonly<
  Record<string, { readonly default: boolean; readonly routes: ReadonlyArray<RouteName> }>
>

export type FeatureName = keyof typeof FEATURES

export const FEATURE_NAMES = Object.keys(FEATURES) as FeatureName[]

/** Which features are on; a missing entry takes the feature's default. */
export const FeatureSwitches = S.record(S.boolean)
export type FeatureSwitches = S.Infer<typeof FeatureSwitches>

export const isFeatureOn = (switches: FeatureSwitches | undefined, name: FeatureName): boolean =>
  switches?.[name] ?? FEATURES[name].default

export const featureSwitches = (switches: FeatureSwitches | undefined): Record<FeatureName, boolean> =>
  Object.fromEntries(FEATURE_NAMES.map((name) => [name, isFeatureOn(switches, name)])) as Record<
    FeatureName,
    boolean
  >

export const featureOfRoute = (route: RouteName): FeatureName | null =>
  FEATURE_NAMES.find((name) => (FEATURES[name].routes as ReadonlyArray<RouteName>).includes(route)) ?? null

export const FEATURE_OFF_MESSAGE = 'This feature is turned off in this organization.'

/** Reads "teaching=off,characters=on" from the environment, for the first start only. */
export const featureSwitchesFrom = (
  text: string,
): { readonly switches: FeatureSwitches; readonly unknown: string[] } => {
  const switches: Record<string, boolean> = {}
  const unknown: string[] = []
  for (const item of text
    .split(',')
    .map((each) => each.trim())
    .filter((each) => each !== '')) {
    const [name = '', value = ''] = item.split('=').map((each) => each.trim())
    if (!FEATURE_NAMES.includes(name as FeatureName) || !/^(on|off)$/.test(value)) unknown.push(item)
    else switches[name] = value === 'on'
  }
  return { switches, unknown }
}
