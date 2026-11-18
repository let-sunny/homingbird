import { Task as T } from '@homingbird/kernel'
import {
  type Api,
  type ApiError,
  type Contract,
  type Conversation,
  ConversationId,
  type DirectoryEntry,
  type DraftRequest,
  DraftRequestId,
  type Member,
  MemberId,
  type Note,
  NoteId,
  type Receipt,
  type RequestOf,
  type ResponseOf,
  type RouteName,
  Unavailable,
  contract,
} from '@homingbird/protocol'

export type Stubs = {
  readonly [N in RouteName]?: (request: RequestOf<Contract[N]>) => ResponseOf<Contract[N]> | ApiError
}

export interface FakeApi {
  readonly api: Api
  readonly calls: Array<{ readonly name: RouteName; readonly request: any }>
}

export const fakeApi = (stubs: Stubs = {}): FakeApi => {
  const calls: FakeApi['calls'] = []
  const api = Object.fromEntries(
    (Object.keys(contract) as RouteName[]).map((name) => [
      name,
      (request: never) =>
        T.suspend(() => {
          calls.push({ name, request })
          const stub = stubs[name] as ((request: never) => unknown) | undefined
          if (stub === undefined) return T.fail(Unavailable({ message: `not stubbed: ${name}` }))
          const answer = stub(request)
          return isApiError(answer) ? T.fail(answer) : T.succeed(answer)
        }),
    ]),
  ) as unknown as Api
  return { api, calls }
}

export const sequentialNonce = (): (() => string) => {
  let count = 0
  return () => `nonce${String(count++).padStart(15, '0')}`
}

export const ANA: Member = {
  id: MemberId.of('ana000000000'),
  email: 'ana@example.com',
  name: 'Ana',
  profile: 'Billing and migrations',
  role: 'admin',
  status: 'active',
  createdAt: 1,
  character: null,
}

export const BEN: Member = {
  ...ANA,
  id: MemberId.of('ben000000000'),
  email: 'ben@example.com',
  name: 'Ben',
  role: 'member',
}

export const CONVERSATION_ID = ConversationId.of('conv00000000')

export const noteOf = (overrides: Partial<Note> = {}): Note => ({
  id: NoteId.of('note00000000'),
  conversationId: CONVERSATION_ID,
  authorId: BEN.id,
  status: 'sent',
  body: 'Is the migration safe?',
  inReplyTo: null,
  origin: 'agent',
  agentName: 'Laptop agent',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  sentAt: 1_700_000_000_000,
  receipts: [receiptOf()],
  ...overrides,
})

export const receiptOf = (overrides: Partial<Receipt> = {}): Receipt => ({
  memberId: ANA.id,
  state: 'delivered',
  deliveredAt: 1_700_000_000_000,
  readAt: null,
  draftingAt: null,
  repliedAt: null,
  ...overrides,
})

export const conversationOf = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: CONVERSATION_ID,
  kind: 'dm',
  title: null,
  participantIds: [ANA.id, BEN.id],
  createdAt: 1,
  lastActivityAt: 1_700_000_000_000,
  lastNote: null,
  unreadCount: 1,
  draftCount: 0,
  archivedAt: null,
  ...overrides,
})

export const requestOf = (overrides: Partial<DraftRequest> = {}): DraftRequest => ({
  id: DraftRequestId.of('request00000'),
  conversationId: CONVERSATION_ID,
  inReplyTo: null,
  instruction: '',
  agentId: null,
  createdAt: 1_700_000_000_000,
  expiresAt: 1_700_086_400_000,
  cancelledAt: null,
  draftIds: [],
  ...overrides,
})

export const entryOf = (member: Member, overrides: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  member,
  presence: { humanOnline: false, agentOnline: true },
  lastSeenAt: null,
  relation: 'none',
  canMessage: true,
  topics: ['billing'],
  ...overrides,
})

export const DIRECTORY = { entries: [entryOf(ANA, { relation: 'self', canMessage: false }), entryOf(BEN)] }

const API_ERROR_TAGS = new Set([
  'Unauthorized',
  'Forbidden',
  'NotFound',
  'Invalid',
  'Conflict',
  'RateLimited',
  'Unavailable',
])

const isApiError = (value: unknown): value is ApiError =>
  typeof value === 'object' && value !== null && API_ERROR_TAGS.has((value as { _tag?: string })._tag ?? '')

export const textOutsideWrappers = (text: string): string =>
  text.replace(/<colleague-note [\s\S]*?\n<\/colleague-note>/g, '')
