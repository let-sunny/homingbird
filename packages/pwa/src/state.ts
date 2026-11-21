import type {
  AsRead,
  ConversationId,
  DraftAsShown,
  DraftRequest,
  MemberId,
  NoteId,
} from '@homingbird/protocol'
import { type ReadableSignal, type Signal, derived, isSameData, signal } from '@homingbird/ui'
import type { Action } from './app.ts'
import { type Roster, agentMembersOf } from './channels.ts'
import { withDraftsAsRead, withReviewsAsRead } from './drafts-read.ts'
import { type Route, parseRoute } from './routes.ts'
import { type ChangeCounter, changeCounter } from './thread-changes.ts'

/** Everything the web client knows, as signals the views redraw from; one per page, made at start. */
export const createState = (hash: string): AppState => {
  const session = signal<AsRead.Me | null | 'loading'>('loading')
  const directory = signal<ReadonlyArray<AsRead.DirectoryEntry>>([])
  const threads = signal<ReadonlyMap<ConversationId, Thread>>(new Map())
  const draftsRead = signal<ReadonlyMap<NoteId, DraftAsShown>>(new Map())
  const channels = signal<ReadonlyArray<AsRead.Channel>>([])
  const reviews = signal<ReadonlyArray<AsRead.Review>>([])
  const reviewsRead = signal<ReadonlyMap<NoteId, DraftAsShown>>(new Map())
  reviews.subscribe((all) => reviewsRead.update((read) => withReviewsAsRead(read, all)))
  threads.subscribe((all) => draftsRead.update((read) => withDraftsAsRead(read, all)))
  const composerTexts = signal<ReadonlyMap<ConversationId, string>>(new Map())
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
    held: signal<HeldDecision | null>(null),
    announcement: signal(''),
    sendingIn: signal<ReadonlySet<ConversationId>>(new Set()),
    draftRequests: signal<ReadonlyArray<DraftRequest>>([]),
    agentCredentials: signal<ReadonlyArray<AsRead.Credential>>([]),
    channels,
    reviews,
    reviewsRead,
    channelAgents: signal<ReadonlyMap<string, AsRead.ChannelAgent>>(new Map()),
    channelsLoaded: signal(false),
    groups: signal<ReadonlyArray<AsRead.Group>>([]),
    groupsLoaded: signal(false),
    rosters: signal<ReadonlyMap<string, Roster>>(new Map()),
    rostersLoading: new Set(),
    threadsLoading: new Set(),
    replyTargets: signal<ReadonlyMap<ConversationId, NoteId | null>>(new Map()),
    composerTexts,
    typedIn: derived([composerTexts], (texts) => new Set(texts.keys()), isSameData),
    composerFocus: signal<ConversationId | null>(null),
    releases: signal<ReadonlyMap<NoteId, Release>>(new Map()),
    archiveDiscards: signal<ReadonlyMap<ConversationId, ReadonlyArray<ArchiveDiscard>>>(new Map()),
    discardedAnswers: signal<ReadonlyMap<NoteId, string>>(new Map()),
    openedForThePerson: signal<ConversationId | null>(null),
    agentReport: signal<AsRead.AgentReport | 'failed' | null>(null),
    taught: signal<AsRead.MyPrinciples | 'failed' | null>(null),
    debates: signal<ReadonlyArray<AsRead.DebateSummary>>([]),
    debatesLoaded: signal(false),
    shownDebate: signal<AsRead.Debate | 'missing' | null>(null),
    members: derived(
      [directory, session, channels],
      (entries, me, known): ReadonlyMap<MemberId, AsRead.Member> =>
        new Map([
          ...agentMembersOf(known),
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
  /** A send or discard the person just made, not yet asked of the server, so that they can undo it. */
  readonly held: Signal<HeldDecision | null>
  readonly announcement: Signal<string>
  readonly sendingIn: Signal<ReadonlySet<ConversationId>>
  readonly draftRequests: Signal<ReadonlyArray<DraftRequest>>
  readonly agentCredentials: Signal<ReadonlyArray<AsRead.Credential>>
  readonly channels: Signal<ReadonlyArray<AsRead.Channel>>
  /** The channels' agents' answers waiting for this person, a manager of their channels. */
  readonly reviews: Signal<ReadonlyArray<AsRead.Review>>
  /** Each answer's text and room as the person first read it, like `draftsRead`. */
  readonly reviewsRead: Signal<ReadonlyMap<NoteId, DraftAsShown>>
  /** The agents of the channels the person manages, as last loaded, by slug. */
  readonly channelAgents: Signal<ReadonlyMap<string, AsRead.ChannelAgent>>
  readonly channelsLoaded: Signal<boolean>
  /** Every group, as the server shows them to the person; none while the organization has groups off. */
  readonly groups: Signal<ReadonlyArray<AsRead.Group>>
  readonly groupsLoaded: Signal<boolean>
  /** The members of the channels the person manages, as last loaded, by slug. */
  readonly rosters: Signal<ReadonlyMap<string, Roster>>
  /** Rosters on their way, by slug and member count, so that each is asked for once. */
  readonly rostersLoading: Set<string>
  /** Conversations the activity panel is loading, so that each is asked for once. */
  readonly threadsLoading: Set<ConversationId>
  readonly replyTargets: Signal<ReadonlyMap<ConversationId, NoteId | null>>
  /** What the person typed in each conversation's composer and has not sent, kept in this browser too. */
  readonly composerTexts: Signal<ReadonlyMap<ConversationId, string>>
  /** The conversations whose composer holds unsent text; changes only when one starts or stops. */
  readonly typedIn: ReadableSignal<ReadonlySet<ConversationId>>
  /** The conversation whose composer should take the focus once it is drawn. */
  readonly composerFocus: Signal<ConversationId | null>
  readonly releases: Signal<ReadonlyMap<NoteId, Release>>
  readonly archiveDiscards: Signal<ReadonlyMap<ConversationId, ReadonlyArray<ArchiveDiscard>>>
  /** Questions whose channel agent's answer this manager discarded here, with the agent's name. */
  readonly discardedAnswers: Signal<ReadonlyMap<NoteId, string>>
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

/** What a held decision does once it is no longer undone, and what the toast says of it meanwhile. */
export interface HeldDecision {
  readonly noteId: NoteId
  readonly text: string
  readonly run: Action
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
