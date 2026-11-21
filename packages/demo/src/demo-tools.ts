import { Schema as S, Task as T } from '@homingbird/kernel'
import {
  type Api,
  type ApiError,
  type AsRead,
  type Authors,
  ConversationId,
  type MemberId,
  type Quoting,
  authorsIn,
  quotedNote,
} from '@homingbird/protocol'
import { ABOUT_THIS_DEMO, DEMO_NOTICE, READ_ONLY } from './tool-notices.ts'

/**
 * What a visiting agent may do on the demo page: look around as June, never act. Every tool reads
 * through `DemoReads`, which holds only routes that read; none sends, approves, discards or changes
 * anything (rule 3), and every note body reaches the model inside `wrapNote` (rule 4).
 */
export const DEMO_TOOLS: ReadonlyArray<DemoTool<any>> = [
  tool({
    name: 'about_this_demo',
    title: 'About this demo',
    description: `Says what Homingbird is, what this page is and what the other tools show. ${DEMO_NOTICE}`,
    quotesColleagues: false,
    input: {},
    describe: {},
    run: () => T.succeed(ABOUT_THIS_DEMO),
  }),
  tool({
    name: 'list_conversations',
    title: 'List June’s conversations',
    description: `Lists the conversations June takes part in, the most recent first: who is in each, when it was last active, how many notes June has not read, and how many of June’s drafts wait in it. ${DEMO_NOTICE}`,
    quotesColleagues: true,
    input: {},
    describe: {},
    run: (_, { api, viewerId }) =>
      T.gen(function* () {
        const people = yield* peopleOf(api)
        const { conversations } = yield* api['conversations.list']({})
        return [
          `June's conversations, ${conversations.length} in all, the most recent first. ${READ_ONLY}`,
          ...conversations.map((conversation) =>
            JSON.stringify({
              conversation: conversation.id,
              name: nameOf(conversation, people, viewerId),
              kind: conversation.kind,
              lastActivity: isoTime(conversation.lastActivityAt),
              unread: conversation.unreadCount,
              draftsWaiting: conversation.draftCount,
              muted: conversation.muted,
            }),
          ),
        ].join('\n')
      }),
  }),
  tool({
    name: 'read_conversation',
    title: 'Read a conversation',
    description: `Reads the sent notes of one of June’s conversations, oldest first, each quoted as a colleague’s text. Drafts are not shown here; list_waiting_drafts shows June’s. ${DEMO_NOTICE}`,
    quotesColleagues: true,
    input: { conversation: ConversationId },
    describe: { conversation: 'The conversation id, from list_conversations.' },
    run: ({ conversation }, context) =>
      T.gen(function* () {
        const people = yield* peopleOf(context.api)
        const room = yield* context.api['conversations.get']({ params: { id: conversation } })
        const { notes } = yield* context.api['conversations.notes']({
          params: { id: conversation },
          query: {},
        })
        const sent = notes.filter((note) => note.status === 'sent')
        const quoting = { authors: people.authors, nonce: context.nonce }
        return [
          `${nameOf(room, people, context.viewerId)} (${conversation}): ${sent.length} sent notes, oldest first. ${READ_ONLY}`,
          ...sent.map((note) =>
            [
              quotedNote(note, quoting),
              `[note ${note.id}${note.inReplyTo === null ? '' : `, in reply to ${note.inReplyTo}`}]`,
            ].join('\n'),
          ),
        ].join('\n\n')
      }),
  }),
  tool({
    name: 'list_waiting_drafts',
    title: 'List drafts waiting for June',
    description: `Lists the drafts June’s agent wrote that wait for June’s approval: which conversation, when, what it replies to, and the draft itself, quoted. Nothing is sent until June clicks Send in the page; no tool can approve. ${DEMO_NOTICE}`,
    quotesColleagues: true,
    input: {},
    describe: {},
    run: (_, context) =>
      T.gen(function* () {
        const people = yield* peopleOf(context.api)
        const { conversations } = yield* context.api['conversations.list']({})
        const { drafts } = yield* context.api['drafts.list']({})
        const quoting = { authors: people.authors, nonce: context.nonce }
        const roomName = (id: string): string => {
          const room = conversations.find((each) => each.id === id)
          return room === undefined ? id : nameOf(room, people, context.viewerId)
        }
        return [
          `Drafts waiting for June's approval: ${drafts.length}. Approving, editing or discarding one is June's click in the page, at #/c/{conversation}; no tool can do it.`,
          ...drafts.map((draft) =>
            [
              JSON.stringify({
                draft: draft.id,
                conversation: draft.conversationId,
                conversationName: roomName(draft.conversationId),
                written: isoTime(draft.createdAt),
                inReplyTo: draft.inReplyTo,
              }),
              quotedNote(draft, quoting),
            ].join('\n'),
          ),
        ].join('\n\n')
      }),
  }),
  tool({
    name: 'list_channels',
    title: 'List channels',
    description: `Lists the channels June can see: what each is for, how many people are in it, whether June joined or manages it, and its agent. A channel agent’s answers are reviewed by its managers in the page, never through a tool. ${DEMO_NOTICE}`,
    quotesColleagues: true,
    input: {},
    describe: {},
    run: (_, { api }) =>
      T.map(({ channels }: { channels: ReadonlyArray<AsRead.Channel> }) =>
        [
          `${channels.length} channels June can see. ${READ_ONLY}`,
          ...channels.map((channel) =>
            JSON.stringify({
              channel: channel.slug,
              description: channel.description,
              visibility: channel.visibility,
              people: channel.memberCount,
              joined: channel.joined,
              managing: channel.managing,
              agent: channel.agent?.name ?? null,
            }),
          ),
        ].join('\n'),
      )(api['channels.list']({ query: { limit: '200' } })),
  }),
]

/**
 * The only routes a demo tool can call: `member` reads, the same an agent could call on a real
 * Dovecote, so the demo shows exactly what an agent can do there (rule 3).
 */
export const DEMO_READ_ROUTES = [
  'conversations.list',
  'conversations.get',
  'conversations.notes',
  'drafts.list',
  'directory.list',
  'channels.list',
] as const

export type DemoReads = Pick<Api, (typeof DEMO_READ_ROUTES)[number]>

/** The client cut down to `DEMO_READ_ROUTES`, so a tool holds no route that writes, even untyped. */
export const demoReadsOf = (api: Api): DemoReads =>
  Object.fromEntries(DEMO_READ_ROUTES.map((name) => [name, api[name]])) as unknown as DemoReads

export interface DemoToolContext {
  readonly api: DemoReads
  readonly viewerId: MemberId
  /** A fresh nonce for each quoted note, as `wrapNote` asks. */
  readonly nonce: () => string
}

export interface DemoTool<F extends S.Fields = S.Fields> {
  readonly name: string
  readonly title: string
  readonly description: string
  /** Whether the answer holds text colleagues wrote: notes, names, channel descriptions. */
  readonly quotesColleagues: boolean
  readonly input: F
  readonly describe: { readonly [K in keyof F]: string }
  readonly run: (input: S.InferFields<F>, context: DemoToolContext) => T.Task<string, ApiError>
}

/** A tool's input as JSON Schema, with each field's description. */
export const inputSchemaOf = (each: DemoTool<any>): S.JsonSchema => {
  const schema = S.toJsonSchema(S.struct(each.input).ast) as { properties: Record<string, object> }
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([field, property]) => [
        field,
        { ...property, description: (each.describe as Record<string, string>)[field] },
      ]),
    ),
  }
}

interface People {
  readonly authors: Authors
  readonly names: ReadonlyMap<MemberId, string>
}

/** Everyone a tool may name: the directory's people, and each visible channel's agent by its name. */
const peopleOf = (api: DemoReads): T.Task<People, ApiError> =>
  T.gen(function* () {
    const { entries } = yield* api['directory.list']({ query: {} })
    const { channels } = yield* api['channels.list']({ query: { limit: '200' } })
    const agents = channels.flatMap(({ agent, slug }) =>
      agent === null || agent === undefined
        ? []
        : [{ member: { id: agent.id, name: agent.name, email: `agent of #${slug}` } }],
    )
    const all = [...entries, ...agents]
    return {
      authors: authorsIn(all),
      names: new Map(all.map((entry) => [entry.member.id, entry.member.name])),
    }
  })

/** A conversation as the web client names it: its title, or the people in it other than June. */
const nameOf = (
  conversation: Pick<AsRead.Conversation, 'kind' | 'title' | 'participantIds'>,
  people: People,
  viewerId: MemberId,
): string => {
  if (conversation.title !== null)
    return conversation.kind === 'channel' ? `#${conversation.title}` : conversation.title
  const others = conversation.participantIds
    .filter((id) => id !== viewerId)
    .map((id) => people.names.get(id) ?? 'Unknown member')
  return others.length === 0 ? 'June' : others.join(', ')
}

const isoTime = (at: number): string => new Date(at).toISOString()

function tool<F extends S.Fields>(definition: DemoTool<F>): DemoTool<F> {
  return definition
}
