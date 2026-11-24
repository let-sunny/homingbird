import type {
  AsRead,
  ConversationId,
  DraftAsShown,
  DraftRequest,
  MemberId,
  NoteId,
} from '@homingbird/protocol'
import { type ReadableSignal, type Signal, batch, derived, isSameData, signal } from '@homingbird/ui'
import type { Action } from './app.ts'
import { type Roster, agentMembersOf } from './channels.ts'
import { withDraftsAsRead, withReviewsAsRead } from './drafts-read.ts'
import { HOLD_SECONDS } from './held-decisions.ts'
import { type Resource, resource } from './resource.ts'
import { type Route, parseRoute } from './routes.ts'
import { type ChangeCounter, changeCounter } from './thread-changes.ts'

/** Everything the web client knows, as signals the views redraw from; one per page, made at start. */
export const createState = (hash: string): AppState => {
  const session = signal<AsRead.Me | null | 'loading'>('loading')
  const directory = signal<ReadonlyArray<AsRead.DirectoryEntry>>([])
  const threads = signal<ReadonlyMap<ConversationId, Thread>>(new Map())
  const draftsRead = signal<ReadonlyMap<NoteId, DraftAsShown>>(new Map())
  const channels = signal<ReadonlyArray<AsRead.Channel>>([])
  const reviews = resource<ReadonlyArray<AsRead.Review>>([])
  const reviewsRead = signal<ReadonlyMap<NoteId, DraftAsShown>>(new Map())
  reviews.subscribe((all) => reviewsRead.update((read) => withReviewsAsRead(read, all)))
  threads.subscribe((all) => draftsRead.update((read) => withDraftsAsRead(read, all)))
  const composerTexts = signal<ReadonlyMap<ConversationId, string>>(new Map())
  return {
    session,
    start: signal<Start>('loading'),
    startRefusal: signal(''),
    startRetrying: signal(false),
    startRestarts: signal(0),
    workspace: signal<Workspace>('loading'),
    workspaceRefusal: signal(''),
    workspaceRestarts: signal(0),
    serverInfo: signal<AsRead.ServerInfo | null>(null),
    branding: signal<Branding>({ name: 'Homingbird', logo: null }),
    route: signal<Route>(parseRoute(hash)),
    conversations: signal<ReadonlyArray<AsRead.Conversation>>([]),
    conversationsLoaded: signal(false),
    conversationLoads: { started: 0, applied: 0 },
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
    awaitingReply: resource<ReadonlyArray<ConversationId>>([]),
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
    suggestions: resource<ReadonlyArray<AsRead.DebateSuggestion>>([]),
    debates: resource<ReadonlyArray<AsRead.DebateSummary>>([]),
    listLoads: { channels: listLoad() },
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
    previewReads: changeCounter(),
    previewAllowance: signal<AsRead.DraftPreviewAllowance | null>(null),
  }
}

/** The person signed in, or null while signed out or still loading. */
export const signedIn = (state: Pick<AppState, 'session'>): AsRead.Me | null => {
  const me = state.session.get()
  return me === 'loading' ? null : me
}

/**
 * Empties the state of everything the person's session put there, as when it ended. Whatever a page adds
 * to the state is emptied too, unless it is named in `OUTLIVES_SESSION`.
 */
export const forgetSession = (state: AppState): void => {
  const initial = createState('')
  batch(() => {
    state.session.set(null)
    for (const key of Object.keys(state) as Array<keyof AppState>)
      if (key !== 'session' && !OUTLIVES_SESSION.has(key)) makeInitial(state[key], initial[key])
  })
}

/** What the page knows of the server and of its own address, which says nothing of who was signed in. */
export const OUTLIVES_SESSION: ReadonlySet<keyof AppState> = new Set(['serverInfo', 'branding', 'route'])

export interface AppState {
  readonly session: Signal<AsRead.Me | null | 'loading'>
  /** How the first load is going while the session is `'loading'`. */
  readonly start: Signal<Start>
  /** What the server refused with when `start` is `'refused'`. */
  readonly startRefusal: Signal<string>
  /** Whether an attempt of the first load failed and is being repeated. */
  readonly startRetrying: Signal<boolean>
  /** Counts the person's asks to start the first load afresh; a running start ends when it changes. */
  readonly startRestarts: Signal<number>
  /** How loading the person's workspace is going, which the lists and the line above them tell of. */
  readonly workspace: Signal<Workspace>
  /** What the server refused the workspace with, when `workspace` is `'failed'` for a reason waiting does not mend. */
  readonly workspaceRefusal: Signal<string>
  /** Counts the person's asks to load the workspace afresh. */
  readonly workspaceRestarts: Signal<number>
  readonly serverInfo: Signal<AsRead.ServerInfo | null>
  readonly branding: Signal<Branding>
  readonly route: Signal<Route>
  readonly conversations: Signal<ReadonlyArray<AsRead.Conversation>>
  readonly conversationsLoaded: Signal<boolean>
  /** Which load of the conversation list started last and which answer was applied last, so an older answer never replaces a newer one. */
  readonly conversationLoads: { started: number; applied: number }
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
  /** The conversations with notes waiting for the person's reply. */
  readonly awaitingReply: Resource<ReadonlyArray<ConversationId>>
  /** The channels' agents' answers waiting for this person, a manager of their channels. */
  readonly reviews: Resource<ReadonlyArray<AsRead.Review>>
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
  readonly suggestions: Resource<ReadonlyArray<AsRead.DebateSuggestion>>
  readonly debates: Resource<ReadonlyArray<AsRead.DebateSummary>>
  /** How the lists that load when their page opens are going, for the words in place of a list that has not come. */
  readonly listLoads: { readonly [List in ListName]: ListLoad }
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
  /** Counts each load and hide of a conversation's previews, so that an older answer never counts. */
  readonly previewReads: ChangeCounter
  /** Whom the person lets see their own agent's drafts early, once loaded. */
  readonly previewAllowance: Signal<AsRead.DraftPreviewAllowance | null>
}

/** Loading, slower than usual, too long (with a way to try again), or given up because the server stays away or refused. */
export type Start = 'loading' | 'slow' | 'long' | 'failed' | 'refused'

/** The lists that load on their own and are no resource, each with its own load. */
export type ListName = 'channels'

/** A list's first answer: still awaited, awaited too long, or not coming. */
export type ListStep = 'loading' | 'long' | 'failed'

/** The step of a list's latest load, and how many loads it has started; a load ends when it sees a newer one begin. */
export interface ListLoad {
  readonly step: Signal<ListStep>
  readonly started: Signal<number>
}

const makeInitial = (held: unknown, initial: unknown): void => {
  if (typeof held !== 'object' || held === null) return
  if (held instanceof Set) held.clear()
  else if (isResource(held)) held.reset()
  else if (isSignal(held)) held.set((initial as Signal<unknown>).get())
  else if (isChangeCounter(held)) held.forget()
  else
    for (const [key, part] of Object.entries(held))
      makeInitial(part, (initial as Readonly<Record<string, unknown>>)[key])
}

const isResource = (held: object): held is Resource<unknown> => 'reset' in held

const isSignal = (held: object): held is Signal<unknown> => 'get' in held && 'set' in held

const isChangeCounter = (held: object): held is ChangeCounter => 'changesTo' in held

const listLoad = (): ListLoad => ({ step: signal<ListStep>('loading'), started: signal(0) })

/** The same steps for the workspace, which is loaded behind the drawn page; `'loaded'` once it is. */
export type Workspace = 'loading' | 'slow' | 'long' | 'failed' | 'loaded'

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
