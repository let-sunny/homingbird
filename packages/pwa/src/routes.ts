import { CHARACTER_ROUTE } from '@homingbird/protocol'

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'conversation'; readonly id: string }
  | { readonly name: 'people' }
  | { readonly name: 'channels' }
  | { readonly name: 'channel'; readonly slug: string }
  | { readonly name: 'debates' }
  | { readonly name: 'debate'; readonly id: string }
  | { readonly name: 'search'; readonly query: string }
  | { readonly name: 'profile' }
  | { readonly name: 'agent'; readonly section: AgentSection | null }
  | { readonly name: 'character'; readonly draft: string | null; readonly from: string | null }
  | { readonly name: 'device'; readonly code: string | null }
  | { readonly name: 'consent'; readonly id: string }
  | { readonly name: 'admin'; readonly section: AdminSection }
  | { readonly name: 'signed-out'; readonly reason: string | null }
  | { readonly name: 'unknown' }

export type AgentSection = 'connection' | 'teaching' | 'doing' | 'routes'

export const AGENT_SECTIONS: ReadonlyArray<AgentSection> = ['connection', 'teaching', 'doing', 'routes']

export type AdminSection = 'settings' | 'members' | 'channels' | 'insights'

export const parseRoute = (hash: string): Route => {
  const [path = '', search = ''] = hash.replace(/^#\/?/, '').split('?')
  const [head = '', second] = path
    .split('/')
    .filter((segment) => segment !== '')
    .map(decodeSegment)
  const parameters = new URLSearchParams(search)
  if (head === '') return { name: 'home' }
  if (head === 'c' && second !== undefined) return { name: 'conversation', id: second }
  if (head === 'people') return { name: 'people' }
  if (head === 'channels') return { name: 'channels' }
  if ((head === 'channel' || head === LEGACY_CHANNEL_HEAD) && second !== undefined)
    return { name: 'channel', slug: second }
  if (head === 'debates') return { name: 'debates' }
  if (head === 'debate' && second !== undefined) return { name: 'debate', id: second }
  if (head === 'search') return { name: 'search', query: parameters.get('q') ?? '' }
  if (head === 'me') return { name: 'profile' }
  if (head === 'agent') return { name: 'agent', section: isAgentSection(second) ? second : null }
  if (head === 'connect' || head === 'credentials') return { name: 'agent', section: 'connection' }
  if (head === CHARACTER_ROUTE)
    return { name: 'character', draft: second ?? null, from: parameters.get('from') }
  if (head === 'device') return { name: 'device', code: second ?? null }
  if (head === 'consent' && second !== undefined) return { name: 'consent', id: second }
  if (head === 'admin') return { name: 'admin', section: isAdminSection(second) ? second : 'settings' }
  if (head === 'signed-out') return { name: 'signed-out', reason: parameters.get('reason') }
  return { name: 'unknown' }
}

export const hrefFor = (route: Route): string => {
  switch (route.name) {
    case 'home':
    case 'unknown':
      return '#/'
    case 'conversation':
      return `#/c/${encodeURIComponent(route.id)}`
    case 'people':
      return '#/people'
    case 'channels':
      return '#/channels'
    case 'channel':
      return `#/channel/${encodeURIComponent(route.slug)}`
    case 'debates':
      return '#/debates'
    case 'debate':
      return `#/debate/${encodeURIComponent(route.id)}`
    case 'search':
      return `#/search?${new URLSearchParams({ q: route.query }).toString()}`
    case 'profile':
      return '#/me'
    case 'agent':
      return route.section === null ? '#/agent' : `#/agent/${route.section}`
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
    case 'signed-out':
      return route.reason === null
        ? '#/signed-out'
        : `#/signed-out?${new URLSearchParams({ reason: route.reason }).toString()}`
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

const ADMIN_SECTIONS: ReadonlyArray<AdminSection> = ['settings', 'members', 'channels', 'insights']

const isAgentSection = (value: string | undefined): value is AgentSection =>
  AGENT_SECTIONS.includes(value as AgentSection)

const isAdminSection = (value: string | undefined): value is AdminSection =>
  ADMIN_SECTIONS.includes(value as AdminSection)

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
