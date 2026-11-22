import { CHARACTER_ROUTE } from '@homingbird/protocol'

export type Route =
  | { readonly name: 'home' }
  | {
      readonly name: 'conversation'
      readonly id: string
      readonly draft: string | null
      /** A channel's agent's answer the person reviews, shown under its question in the room. */
      readonly review?: string
      /** A sent note a copied link or a draft's source points at, brought into view when the conversation opens. */
      readonly note?: string
    }
  /** People, with the card of one member brought into view when a profile card opened it. */
  | { readonly name: 'people'; readonly person?: string }
  /** A note to people the person picks first; `to` names whom they chose already, as from a person's card. */
  | { readonly name: 'new'; readonly to: ReadonlyArray<string> }
  | { readonly name: 'group'; readonly id: string }
  | { readonly name: 'channels' }
  | { readonly name: 'channel'; readonly slug: string }
  | {
      readonly name: 'channel-agent'
      readonly slug: string
      readonly draft: string | null
      /** The Teach tab rather than the answers. */
      readonly teach?: true
    }
  | { readonly name: 'debates' }
  /** A debate room, on one of its tabs; none asked for shows the tab its state calls for. */
  | {
      readonly name: 'debate'
      readonly id: string
      readonly tab: DebateTab | null
      /** A turn a result, a credit or another turn cites, brought into view on the Turns tab. */
      readonly turn?: number
    }
  | { readonly name: 'search'; readonly query: string }
  /** Everything waiting for the person, as a page: what the header's bell opens without popovers. */
  | { readonly name: 'activity' }
  | { readonly name: 'profile' }
  | { readonly name: 'agent'; readonly section: AgentSection | null }
  | { readonly name: 'measured' }
  | { readonly name: 'character'; readonly draft: string | null; readonly from: string | null }
  | { readonly name: 'device'; readonly code: string | null }
  | { readonly name: 'consent'; readonly id: string }
  | { readonly name: 'admin'; readonly section: AdminSection }
  | { readonly name: 'admin-group'; readonly id: string }
  | { readonly name: 'signed-out'; readonly reason: string | null }
  | { readonly name: 'invite'; readonly code: string }
  | { readonly name: 'invite-refused' }
  /** A single-use link the Homingbird app sent in Slack, confirmed here. */
  | { readonly name: 'slack-link'; readonly code: string }
  | { readonly name: 'unknown' }

export type AgentSection = 'connection' | 'teaching' | 'doing' | 'previews'

export const AGENT_SECTIONS: ReadonlyArray<AgentSection> = ['connection', 'teaching', 'doing', 'previews']

export type DebateTab = 'result' | 'votes' | 'credit' | 'turns'

export const DEBATE_TABS: ReadonlyArray<DebateTab> = ['result', 'votes', 'credit', 'turns']

export type AdminSection = 'settings' | 'members' | 'groups' | 'channels' | 'insights'

export const parseRoute = (hash: string): Route => {
  const [path = '', search = ''] = hash.replace(/^#\/?/, '').split('?')
  const [head = '', second, third, fourth] = path
    .split('/')
    .filter((segment) => segment !== '')
    .map(decodeSegment)
  const parameters = new URLSearchParams(search)
  if (head === '') return { name: 'home' }
  if (head === 'c' && second !== undefined) {
    const review = parameters.get('review')
    const note = parameters.get('note')
    return {
      name: 'conversation',
      id: second,
      draft: parameters.get('draft'),
      ...(review !== null && { review }),
      ...(note !== null && { note }),
    }
  }
  if (head === 'people') {
    const person = parameters.get('person')
    return person === null ? { name: 'people' } : { name: 'people', person }
  }
  if (head === 'new') return { name: 'new', to: memberIdsIn(parameters.get('to')) }
  if (head === 'group' && second !== undefined) return { name: 'group', id: second }
  if (head === 'channels') return { name: 'channels' }
  if (head === 'channel' && second !== undefined && third === 'agent')
    return {
      name: 'channel-agent',
      slug: second,
      draft: parameters.get('draft'),
      ...(fourth === TEACH_SEGMENT && { teach: true }),
    }
  if ((head === 'channel' || head === LEGACY_CHANNEL_HEAD) && second !== undefined)
    return { name: 'channel', slug: second }
  if (head === 'debates') return { name: 'debates' }
  if (head === 'debate' && second !== undefined) {
    const turn = turnNumber(parameters.get('turn'))
    return {
      name: 'debate',
      id: second,
      tab: isDebateTab(third) ? third : null,
      ...(turn !== null && { turn }),
    }
  }
  if (head === 'activity') return { name: 'activity' }
  if (head === 'search') return { name: 'search', query: parameters.get('q') ?? '' }
  if (head === 'me') return { name: 'profile' }
  if (head === 'agent' && second === RETIRED_ROUTE_MAP) return { name: 'agent', section: 'doing' }
  if (head === 'agent') return { name: 'agent', section: isAgentSection(second) ? second : null }
  if (head === 'measured') return { name: 'measured' }
  if (head === 'connect' || head === 'credentials') return { name: 'agent', section: 'connection' }
  if (head === CHARACTER_ROUTE)
    return { name: 'character', draft: second ?? null, from: parameters.get('from') }
  if (head === 'device') return { name: 'device', code: second ?? null }
  if (head === 'consent' && second !== undefined) return { name: 'consent', id: second }
  if (head === 'admin' && second === 'groups' && third !== undefined)
    return { name: 'admin-group', id: third }
  if (head === 'admin') return { name: 'admin', section: isAdminSection(second) ? second : 'settings' }
  if (head === 'signed-out') return { name: 'signed-out', reason: parameters.get('reason') }
  if (head === 'invite' && second !== undefined) return { name: 'invite', code: second }
  if (head === 'invite-refused') return { name: 'invite-refused' }
  if (head === 'slack' && second === 'link' && third !== undefined) return { name: 'slack-link', code: third }
  return { name: 'unknown' }
}

export const hrefFor = (route: Route): string => {
  switch (route.name) {
    case 'home':
    case 'unknown':
      return '#/'
    case 'conversation':
      return withQuery(`#/c/${encodeURIComponent(route.id)}`, {
        ...(route.draft !== null && { draft: route.draft }),
        ...(route.review !== undefined && { review: route.review }),
        ...(route.note !== undefined && { note: route.note }),
      })
    case 'people':
      return withQuery('#/people', route.person === undefined ? {} : { person: route.person })
    case 'new':
      return route.to.length === 0
        ? '#/new'
        : `#/new?${new URLSearchParams({ to: route.to.join(',') }).toString()}`
    case 'group':
      return `#/group/${encodeURIComponent(route.id)}`
    case 'channels':
      return '#/channels'
    case 'channel':
      return `#/channel/${encodeURIComponent(route.slug)}`
    case 'channel-agent': {
      const base = `#/channel/${encodeURIComponent(route.slug)}/agent${route.teach === true ? `/${TEACH_SEGMENT}` : ''}`
      return route.draft === null ? base : `${base}?${new URLSearchParams({ draft: route.draft }).toString()}`
    }
    case 'debates':
      return '#/debates'
    case 'debate':
      return withQuery(
        route.tab === null
          ? `#/debate/${encodeURIComponent(route.id)}`
          : `#/debate/${encodeURIComponent(route.id)}/${route.tab}`,
        route.turn === undefined ? {} : { turn: String(route.turn) },
      )
    case 'activity':
      return '#/activity'
    case 'search':
      return `#/search?${new URLSearchParams({ q: route.query }).toString()}`
    case 'profile':
      return '#/me'
    case 'agent':
      return route.section === null ? '#/agent' : `#/agent/${route.section}`
    case 'measured':
      return '#/measured'
    case 'character':
      return route.draft !== null
        ? `#/${CHARACTER_ROUTE}/${encodeURIComponent(route.draft)}`
        : route.from !== null
          ? `#/${CHARACTER_ROUTE}?${new URLSearchParams({ from: route.from }).toString()}`
          : `#/${CHARACTER_ROUTE}`
    case 'device':
      return route.code === null ? '#/device' : `#/device/${encodeURIComponent(route.code)}`
    case 'consent':
      return `#/consent/${encodeURIComponent(route.id)}`
    case 'admin':
      return `#/admin/${route.section}`
    case 'admin-group':
      return `#/admin/groups/${encodeURIComponent(route.id)}`
    case 'signed-out':
      return route.reason === null
        ? '#/signed-out'
        : `#/signed-out?${new URLSearchParams({ reason: route.reason }).toString()}`
    case 'invite':
      return `#/invite/${encodeURIComponent(route.code)}`
    case 'invite-refused':
      return '#/invite-refused'
    case 'slack-link':
      return `#/slack/link/${encodeURIComponent(route.code)}`
  }
}

/** The address an old link should be replaced with, or null when it is current. */
export const currentHashFor = (hash: string): string | null =>
  hash.startsWith(`#/${LEGACY_CHANNEL_HEAD}/`) || /^#\/(?:connect|credentials)(?:[/?]|$)/.test(hash)
    ? hrefFor(parseRoute(hash))
    : null

export const arrivedToConnect = (current: Route): boolean =>
  (current.name === 'device' && current.code !== null) || current.name === 'consent'

export const signInHref = (hash: string): string =>
  `/auth/login?${new URLSearchParams({ return_to: `/${hash.startsWith('#/signed-out') ? '' : hash}` }).toString()}`

const LEGACY_CHANNEL_HEAD = 't'

const ADMIN_SECTIONS: ReadonlyArray<AdminSection> = ['settings', 'members', 'groups', 'channels', 'insights']

const TEACH_SEGMENT = 'teach'

/** The address of the retired route map, which leads to where its question is answered now. */
const RETIRED_ROUTE_MAP = 'routes'

const isAgentSection = (value: string | undefined): value is AgentSection =>
  AGENT_SECTIONS.includes(value as AgentSection)

const isDebateTab = (value: string | undefined): value is DebateTab =>
  DEBATE_TABS.includes(value as DebateTab)

const turnNumber = (value: string | null): number | null =>
  value !== null && /^[1-9]\d{0,2}$/.test(value) ? Number(value) : null

const isAdminSection = (value: string | undefined): value is AdminSection =>
  ADMIN_SECTIONS.includes(value as AdminSection)

const memberIdsIn = (value: string | null): ReadonlyArray<string> =>
  (value ?? '').split(',').filter((memberId) => memberId !== '')

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

const withQuery = (path: string, query: Readonly<Record<string, string>>): string => {
  const search = new URLSearchParams(query).toString()
  return search === '' ? path : `${path}?${search}`
}
