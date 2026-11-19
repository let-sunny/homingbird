import type {
  AgentReport,
  Channel,
  Contact,
  Conversation,
  ConversationId,
  Credential,
  Debate,
  DebateSummary,
  DirectoryEntry,
  DraftRequest,
  Me,
  Member,
  MemberId,
  MyPrinciples,
  Note,
  NoteId,
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
  readonly link?: { readonly href: string; readonly label: string }
}

export interface Release {
  readonly reason: string | null
  readonly agentName: string | null
}

export interface ArchiveDiscard {
  readonly noteId: NoteId
  readonly channel: string
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
export const conversationsLoaded = signal(false)
export const threads = signal<ReadonlyMap<ConversationId, Thread>>(new Map())
export const directory = signal<ReadonlyArray<DirectoryEntry>>([])
export const contacts = signal<ReadonlyArray<Contact>>([])
export const connection = signal<Connection>('connecting')
export const notice = signal<Notice | null>(null)
export const announcement = signal('')
export const sendingIn = signal<ReadonlySet<ConversationId>>(new Set())
export const draftRequests = signal<ReadonlyArray<DraftRequest>>([])
export const agentCredentials = signal<ReadonlyArray<Credential>>([])
export const channels = signal<ReadonlyArray<Channel>>([])
export const channelsLoaded = signal(false)
export const replyTargets = signal<ReadonlyMap<ConversationId, string | null>>(new Map())
export const releases = signal<ReadonlyMap<NoteId, Release>>(new Map())
export const archiveDiscards = signal<ReadonlyMap<ConversationId, ReadonlyArray<ArchiveDiscard>>>(new Map())
export const openedForThePerson = signal<ConversationId | null>(null)
export const agentReport = signal<AgentReport | 'failed' | null>(null)
export const taught = signal<MyPrinciples | 'failed' | null>(null)
export const debates = signal<ReadonlyArray<DebateSummary>>([])
export const debatesLoaded = signal(false)
export const shownDebate = signal<Debate | 'missing' | null>(null)

export const members = derived(
  [directory, session],
  (entries, me): ReadonlyMap<MemberId, Member> =>
    new Map([
      ...(me !== null && me !== 'loading' ? [[me.member.id, me.member] as const] : []),
      ...entries.map((entry) => [entry.member.id, entry.member] as const),
    ]),
)

export const memberNamed = (id: MemberId): Member | undefined => members.get().get(id)

export const signedIn = (): Me | null => {
  const me = session.get()
  return me === 'loading' ? null : me
}
