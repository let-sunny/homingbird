import type {
  Contact,
  Conversation,
  ConversationId,
  DirectoryEntry,
  Me,
  Member,
  MemberId,
  Note,
  ServerInfo,
} from '@homingbird/protocol'
import { derived, signal } from '@homingbird/ui'
import { type Route, parseRoute } from './routes.ts'

export type Connection = 'connecting' | 'live' | 'polling' | 'offline'

export interface Thread {
  readonly notes: ReadonlyArray<Note>
  readonly hasMore: boolean
}

export interface Notice {
  readonly kind: 'error' | 'info'
  readonly text: string
}

export interface Branding {
  readonly name: string
  readonly logo: string | null
}

export const session = signal<Me | null | 'loading'>('loading')
export const serverInfo = signal<ServerInfo | null>(null)
export const branding = signal<Branding>({ name: 'Homingbird', logo: null })
export const route = signal<Route>(parseRoute(globalThis.location?.hash ?? ''))
export const conversations = signal<ReadonlyArray<Conversation>>([])
export const threads = signal<ReadonlyMap<ConversationId, Thread>>(new Map())
export const directory = signal<ReadonlyArray<DirectoryEntry>>([])
export const contacts = signal<ReadonlyArray<Contact>>([])
export const connection = signal<Connection>('connecting')
export const notice = signal<Notice | null>(null)
export const announcement = signal('')
export const sendingIn = signal<ReadonlySet<ConversationId>>(new Set())
export const replyTargets = signal<ReadonlyMap<ConversationId, string | null>>(new Map())

export const members = derived(
  [directory, session],
  (entries, me): ReadonlyMap<MemberId, Member> =>
    new Map([
      ...entries.map((entry) => [entry.member.id, entry.member] as const),
      ...(me !== null && me !== 'loading' ? [[me.member.id, me.member] as const] : []),
    ]),
)

export const signedIn = (): Me | null => {
  const me = session.get()
  return me === 'loading' ? null : me
}
