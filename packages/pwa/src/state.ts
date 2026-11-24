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
import { HOLD_SECONDS } from './held-decisions.ts'
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
    start: signal<Start>('loading'),
    startRefusal: signal(''),
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
    held: signal<ReadonlyArray<HeldDecision>>([]),
    heldSecondsLeft: signal(HOLD_SECONDS),
    draftEdits: signal<ReadonlyMap<NoteId, string>>(new Map()),
    announcement: signal(''),
    sendingIn: signal<ReadonlySet<ConversationId>>(new Set()),
    draftRequests: signal<ReadonlyArray<DraftRequest>>([]),
    agentCredentials: signal<ReadonlyArray<AsRead.Credential>>([]),
    channels,
    reviews,
    reviewsRead,
    channelAgents: signal<ReadonlyMap<string, AsRead.ChannelAgent>>(new Map()),
    channelTeaching: signal<ReadonlyMap<string, AsRead.ChannelTeaching | 'failed'>>(new Map()),
    channelsLoaded: signal(false),
    groups: signal<ReadonlyArray<AsRead.Group>>([]),
    groupsLoaded: signal(false),
    rosters: signal<ReadonlyMap<string, Roster>>(new Map()),
    rostersLoading: new Set(),
    threadsLoading: new Set(),
    replyTargets: signal<ReadonlyMap<ConversationId, NoteId | null>>(new Map()),
    composerTexts,
    composerTags: signal<ReadonlyMap<ConversationId, ReadonlyArray<MemberId>>>(new Map()),
    typedIn: derived([composerTexts], (texts) => new Set(texts.keys()), isSameData),
    composerFocus: signal<ConversationId | null>(null),
    releases: signal<ReadonlyMap<NoteId, Release>>(new Map()),
    archiveDiscards: signal<ReadonlyMap<ConversationId, ReadonlyArray<ArchiveDiscard>>>(new Map()),
    discardedAnswers: signal<ReadonlyMap<NoteId, string>>(new Map()),
    openedForThePerson: signal<ConversationId | null>(null),
    agentReport: signal<AsRead.AgentReport | 'failed' | null>(null),
    taught: signal<AsRead.MyPrinciples | 'failed' | null>(null),
    interview: signal<AsRead.TeachingInterview | 'failed' | null>(null),
    suggestions: signal<ReadonlyArray<AsRead.DebateSuggestion>>([]),
    debates: signal<ReadonlyArray<AsRead.DebateSummary>>([]),
    debatesLoaded: signal(false),
    shownDebate: signal<AsRead.Debate | 'missing' | null>(null),
    waitingOnly: signal(false),
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
    previews: signal<ReadonlyMap<ConversationId, ReadonlyArray<AsRead.DraftPreview>>>(new Map()),
    previewedBodies: signal<ReadonlyMap<NoteId, string>>(new Map()),
    previewAllowance: signal<AsRead.DraftPreviewAllowance | null>(null),
  }
}

/** The person signed in, or null while signed out or still loading. */
export const signedIn = (state: Pick<AppState, 'session'>): AsRead.Me | null => {
  const me = state.session.get()
  return me === 'loading' ? null : me
}

export interface AppState {
  readonly session: Signal<AsRead.Me | null | 'loading'>
  /** How the first load is going while the session is `'loading'`. */
  readonly start: Signal<Start>
  /** What the server refused with when `start` is `'refused'`. */
  readonly startRefusal: Signal<string>
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
  /**
   * The sends and discards the person just made, oldest first: at most one still waits and can be undone,
   * the others are on their way to the server or just carried out, so their cards stay in place meanwhile.
   */
  readonly held: Signal<ReadonlyArray<HeldDecision>>
  /** The whole seconds left before the held decision that can be undone is carried out. */
  readonly heldSecondsLeft: Signal<number>
  /** Each card's edit the person made and has not sent, by draft or answer, like unsent composer text. */
  readonly draftEdits: Signal<ReadonlyMap<NoteId, string>>
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
  /** What the managers taught the agents of the channels the person manages, as last loaded, by slug. */
  readonly channelTeaching: Signal<ReadonlyMap<string, AsRead.ChannelTeaching | 'failed'>>
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
  /** The people the person tagged with @ in a group message's composer and has not sent to yet. */
  readonly composerTags: Signal<ReadonlyMap<ConversationId, ReadonlyArray<MemberId>>>
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
  /** The pasted principles document and the proposals the person's agent made in a teaching chat. */
  readonly interview: Signal<AsRead.TeachingInterview | 'failed' | null>
  /** The short debates the person's agent suggested, each a card until they open the room or answer alone. */
  readonly suggestions: Signal<ReadonlyArray<AsRead.DebateSuggestion>>
  readonly debates: Signal<ReadonlyArray<AsRead.DebateSummary>>
  readonly debatesLoaded: Signal<boolean>
  readonly shownDebate: Signal<AsRead.Debate | 'missing' | null>
  /** Whether the conversation list shows only what waits for the person. */
  readonly waitingOnly: Signal<boolean>
  readonly members: ReadableSignal<ReadonlyMap<MemberId, AsRead.Member>>
  readonly changes: ChangeCounter
  /** Drafts already reported as seen in this page. */
  readonly seenDrafts: Set<NoteId>
  /** Other people's agents' unconfirmed drafts this person may see, by conversation, as last loaded. */
  readonly previews: Signal<ReadonlyMap<ConversationId, ReadonlyArray<AsRead.DraftPreview>>>
  /** Each preview's words as this page last showed them, so a sent note can say whether they changed. */
  readonly previewedBodies: Signal<ReadonlyMap<NoteId, string>>
  /** Whom the person lets see their own agent's drafts early, once loaded. */
  readonly previewAllowance: Signal<AsRead.DraftPreviewAllowance | null>
}

/** Loading, still loading after an attempt failed, or given up, because the server stays away or refused. */
export type Start = 'loading' | 'slow' | 'failed' | 'refused'

export type Connection = 'connecting' | 'live' | 'polling' | 'offline'

export interface Thread {
  readonly notes: ReadonlyArray<AsRead.Note>
  readonly hasMore: boolean
}

/** What a held decision does once it is no longer undone, and what its card and the toast say of it. */
export interface HeldDecision {
  readonly noteId: NoteId
  readonly conversationId: ConversationId
  readonly kind: 'send' | 'discard'
  /** A channel's agent's answer the person reviews, rather than their own agent's draft. */
  readonly review: boolean
  /** How many of the person's own drafts it settles: the draft, and the alternatives a send discards. */
  readonly settles: number
  readonly words: HeldWords
  readonly run: Action
  /** Waiting can still be undone; committing is on its way to the server; done is carried out. */
  readonly phase: 'waiting' | 'committing' | 'done'
}

/**
 * What a held decision is called while it can be undone, while it is on its way, once it is carried out,
 * and when the page closed first.
 */
export interface HeldWords {
  /** While it can be undone, one sentence for each whole second left, from one second up. */
  readonly waiting: ReadonlyArray<string>
  readonly pending: string
  readonly done: string
  readonly notDone: string
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
