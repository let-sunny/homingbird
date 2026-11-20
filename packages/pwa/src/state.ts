import type {
  AsRead,
  ConversationId,
  DraftAsShown,
  DraftRequest,
  MemberId,
  NoteId,
} from '@homingbird/protocol'
import { type ReadableSignal, type Signal, derived, signal } from '@homingbird/ui'
import type { Roster } from './channels.ts'
import { withDraftsAsRead } from './drafts-read.ts'
import { type Route, parseRoute } from './routes.ts'
import { type ChangeCounter, changeCounter } from './thread-changes.ts'

/** Everything the web client knows, as signals the views redraw from; one per page, made at start. */
export const createState = (hash: string): AppState => {
  const session = signal<AsRead.Me | null | 'loading'>('loading')
  const directory = signal<ReadonlyArray<AsRead.DirectoryEntry>>([])
  const threads = signal<ReadonlyMap<ConversationId, Thread>>(new Map())
  const draftsRead = signal<ReadonlyMap<NoteId, DraftAsShown>>(new Map())
  threads.subscribe((all) => draftsRead.update((read) => withDraftsAsRead(read, all)))
  return {
    session,
    serverInfo: signal<AsRead.ServerInfo | null>(null),
    branding: signal<Branding>({ name: 'Homingbird', logo: null }),
    route: signal<Route>(parseRoute(hash)),
    conversations: signal<ReadonlyArray<AsRead.Conversation>>([]),
    conversationsLoaded: signal(false),
    threads,
    draftsRead,
    directory,
    directoryLoaded: signal(false),
    contacts: signal<ReadonlyArray<AsRead.Contact>>([]),
    connection: signal<Connection>('connecting'),
    notice: signal<Notice | null>(null),
    announcement: signal(''),
    sendingIn: signal<ReadonlySet<ConversationId>>(new Set()),
    draftRequests: signal<ReadonlyArray<DraftRequest>>([]),
    agentCredentials: signal<ReadonlyArray<AsRead.Credential>>([]),
    channels: signal<ReadonlyArray<AsRead.Channel>>([]),
    channelsLoaded: signal(false),
    groups: signal<ReadonlyArray<AsRead.Group>>([]),
    groupsLoaded: signal(false),
    rosters: signal<ReadonlyMap<string, Roster>>(new Map()),
    rostersLoading: new Set(),
    replyTargets: signal<ReadonlyMap<ConversationId, string | null>>(new Map()),
    releases: signal<ReadonlyMap<NoteId, Release>>(new Map()),
    archiveDiscards: signal<ReadonlyMap<ConversationId, ReadonlyArray<ArchiveDiscard>>>(new Map()),
    openedForThePerson: signal<ConversationId | null>(null),
    agentReport: signal<AsRead.AgentReport | 'failed' | null>(null),
    taught: signal<AsRead.MyPrinciples | 'failed' | null>(null),
    debates: signal<ReadonlyArray<AsRead.DebateSummary>>([]),
    debatesLoaded: signal(false),
    shownDebate: signal<AsRead.Debate | 'missing' | null>(null),
    members: derived(
      [directory, session],
      (entries, me): ReadonlyMap<MemberId, AsRead.Member> =>
        new Map([
          ...(me !== null && me !== 'loading' ? [[me.member.id, me.member] as const] : []),
          ...entries.map((entry) => [entry.member.id, entry.member] as const),
        ]),
    ),
    changes: changeCounter(),
    seenDrafts: new Set(),
  }
}

/** The person signed in, or null while signed out or still loading. */
export const signedIn = (state: Pick<AppState, 'session'>): AsRead.Me | null => {
  const me = state.session.get()
  return me === 'loading' ? null : me
}

export interface AppState {
  readonly session: Signal<AsRead.Me | null | 'loading'>
  readonly serverInfo: Signal<AsRead.ServerInfo | null>
  readonly branding: Signal<Branding>
  readonly route: Signal<Route>
  readonly conversations: Signal<ReadonlyArray<AsRead.Conversation>>
  readonly conversationsLoaded: Signal<boolean>
  readonly threads: Signal<ReadonlyMap<ConversationId, Thread>>
  /** Each draft's text and room as the person last read them on this page. */
  readonly draftsRead: Signal<ReadonlyMap<NoteId, DraftAsShown>>
  readonly directory: Signal<ReadonlyArray<AsRead.DirectoryEntry>>
  readonly directoryLoaded: Signal<boolean>
  readonly contacts: Signal<ReadonlyArray<AsRead.Contact>>
  readonly connection: Signal<Connection>
  readonly notice: Signal<Notice | null>
  readonly announcement: Signal<string>
  readonly sendingIn: Signal<ReadonlySet<ConversationId>>
  readonly draftRequests: Signal<ReadonlyArray<DraftRequest>>
  readonly agentCredentials: Signal<ReadonlyArray<AsRead.Credential>>
  readonly channels: Signal<ReadonlyArray<AsRead.Channel>>
  readonly channelsLoaded: Signal<boolean>
  /** Every group, as the server shows them to the person; none while the organization has groups off. */
  readonly groups: Signal<ReadonlyArray<AsRead.Group>>
  readonly groupsLoaded: Signal<boolean>
  /** The members of the channels the person manages, as last loaded, by slug. */
  readonly rosters: Signal<ReadonlyMap<string, Roster>>
  /** Rosters on their way, by slug and member count, so that each is asked for once. */
  readonly rostersLoading: Set<string>
  readonly replyTargets: Signal<ReadonlyMap<ConversationId, string | null>>
  readonly releases: Signal<ReadonlyMap<NoteId, Release>>
  readonly archiveDiscards: Signal<ReadonlyMap<ConversationId, ReadonlyArray<ArchiveDiscard>>>
  readonly openedForThePerson: Signal<ConversationId | null>
  readonly agentReport: Signal<AsRead.AgentReport | 'failed' | null>
  readonly taught: Signal<AsRead.MyPrinciples | 'failed' | null>
  readonly debates: Signal<ReadonlyArray<AsRead.DebateSummary>>
  readonly debatesLoaded: Signal<boolean>
  readonly shownDebate: Signal<AsRead.Debate | 'missing' | null>
  readonly members: ReadableSignal<ReadonlyMap<MemberId, AsRead.Member>>
  readonly changes: ChangeCounter
  /** Drafts already reported as seen in this page. */
  readonly seenDrafts: Set<NoteId>
}

export type Connection = 'connecting' | 'live' | 'polling' | 'offline'

export interface Thread {
  readonly notes: ReadonlyArray<AsRead.Note>
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
