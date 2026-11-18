import { CHARACTER_ROUTE } from '@homingbird/protocol'

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'conversation'; readonly id: string }
  | { readonly name: 'people' }
  | { readonly name: 'topics' }
  | { readonly name: 'topic'; readonly slug: string }
  | { readonly name: 'search'; readonly query: string }
  | { readonly name: 'profile' }
  | { readonly name: 'character'; readonly draft: string | null; readonly from: string | null }
  | { readonly name: 'credentials' }
  | { readonly name: 'connect' }
  | { readonly name: 'device'; readonly code: string | null }
  | { readonly name: 'consent'; readonly id: string }
  | { readonly name: 'admin'; readonly section: AdminSection }
  | { readonly name: 'signed-out'; readonly reason: string | null }
  | { readonly name: 'unknown' }

export type AdminSection = 'settings' | 'members' | 'topics' | 'audit'

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
  if (head === 'topics') return { name: 'topics' }
  if (head === 't' && second !== undefined) return { name: 'topic', slug: second }
  if (head === 'search') return { name: 'search', query: parameters.get('q') ?? '' }
  if (head === 'me') return { name: 'profile' }
  if (head === CHARACTER_ROUTE)
    return { name: 'character', draft: second ?? null, from: parameters.get('from') }
  if (head === 'credentials') return { name: 'credentials' }
  if (head === 'connect') return { name: 'connect' }
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
    case 'topics':
      return '#/topics'
    case 'topic':
      return `#/t/${encodeURIComponent(route.slug)}`
    case 'search':
      return `#/search?${new URLSearchParams({ q: route.query }).toString()}`
    case 'profile':
      return '#/me'
    case 'character':
      return route.draft !== null
        ? `#/${CHARACTER_ROUTE}/${encodeURIComponent(route.draft)}`
        : route.from !== null
          ? `#/${CHARACTER_ROUTE}?${new URLSearchParams({ from: route.from }).toString()}`
          : `#/${CHARACTER_ROUTE}`
    case 'credentials':
      return '#/credentials'
    case 'connect':
      return '#/connect'
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

export const arrivedToConnect = (current: Route): boolean =>
  (current.name === 'device' && current.code !== null) || current.name === 'consent'

export const signInHref = (hash: string): string =>
  `/auth/login?${new URLSearchParams({ return_to: `/${hash.startsWith('#/signed-out') ? '' : hash}` }).toString()}`

const ADMIN_SECTIONS: ReadonlyArray<AdminSection> = ['settings', 'members', 'topics', 'audit']

const isAdminSection = (value: string | undefined): value is AdminSection =>
  ADMIN_SECTIONS.includes(value as AdminSection)

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
