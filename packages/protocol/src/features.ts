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
  hideConversations: { default: true, routes: ['conversations.hide', 'conversations.unhide'] },
  leaveGroups: { default: true, routes: ['conversations.leave'] },
  tagging: { default: true, routes: [] },
  webPush: { default: true, routes: ['push.key', 'push.subscribe', 'push.test', 'push.unsubscribe'] },
  answeringFlow: { default: true, routes: ['answeringFlow.get'] },
  earlierAnswers: { default: true, routes: ['answers.earlier', 'answers.used'] },
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
      'teaching.material',
      'teaching.document.set',
      'principleProposals.list',
      'principleProposals.create',
      'principleProposals.accept',
      'principleProposals.acceptAll',
      'principleProposals.discard',
    ],
  },
  agentFigures: { default: true, routes: ['insights.mine'] },
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
      'debates.brief.set',
      'debates.limits.set',
      'debates.turns.post',
      'debates.result.draft',
      'debates.result.vote',
      'debates.result.post',
      'debates.export',
    ],
  },
  schedulingRooms: {
    default: false,
    routes: ['scheduling.create', 'scheduling.slots.set', 'debates.slots.post'],
  },
  debateSuggestions: {
    default: false,
    routes: [
      'debateSuggestions.create',
      'debateSuggestions.list',
      'debateSuggestions.accept',
      'debateSuggestions.dismiss',
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
      'channels.agent.figures',
      'channels.agent.decisions',
      'channels.agent.teaching.get',
      'channels.agent.teaching.set',
      'channels.agent.principles.create',
      'channels.agent.principles.update',
      'channels.agent.principles.reorder',
      'channels.agent.principles.delete',
      'channels.askPrivately',
      'reviews.list',
      'reviews.get',
    ],
  },
  cloudDesk: {
    default: false,
    routes: ['me.deskWake.get', 'me.deskWake.set', 'me.deskWake.test'],
  },
  slack: {
    default: false,
    routes: [
      'admin.slack.get',
      'admin.slack.credentials.set',
      'admin.slack.credentials.remove',
      'me.slack.get',
      'me.slack.connect',
      'me.slack.link',
      'slack.codes.get',
      'channels.slack.link',
      'notes.posting.retry',
    ],
  },
  joinCodes: { default: true, routes: ['joinCodes.create', 'joinCodes.status'] },
  deskAvailability: { default: true, routes: ['me.desk.unavailable', 'me.desk.available'] },
  invites: { default: true, routes: ['invites.list', 'invites.create', 'invites.revoke'] },
  analytics: { default: false, routes: ['analytics.track'] },
  autoSend: { default: false, routes: ['principles.autoSend.set', 'notes.recall'] },
  draftPreviews: {
    default: false,
    routes: ['me.draftPreviews.get', 'me.draftPreviews.set', 'previews.list'],
  },
} as const satisfies Readonly<
  Record<string, { readonly default: boolean; readonly routes: ReadonlyArray<RouteName> }>
>

export type FeatureName = keyof typeof FEATURES

/**
 * Switches whose feature is gone for good: `HB_FEATURES` still accepts and ignores them for one release,
 * so that a server set up with one starts, and the next release forgets them.
 */
export const RETIRED_FEATURES: ReadonlyArray<string> = ['routeMap']

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
    const valid = /^(on|off)$/.test(value)
    if (valid && RETIRED_FEATURES.includes(name)) continue
    if (!FEATURE_NAMES.includes(name as FeatureName) || !valid) unknown.push(item)
    else switches[name] = value === 'on'
  }
  return { switches, unknown }
}
