import type { AsRead, ConversationId, GroupId, MemberId, NoteId } from '@homingbird/protocol'

export const ANA = 'mem_ana000000000' as MemberId
export const BEN = 'mem_ben000000000' as MemberId
export const CY = 'mem_cy0000000000' as MemberId
export const ROOM = 'conv_room00000000' as ConversationId
export const CHANNEL_ROOM = 'conv_chan00000000' as ConversationId
export const TEAM = 'grp_team00000000' as GroupId
export const OPS = 'grp_ops000000000' as GroupId

export const member = (id: MemberId, name: string, fields: Partial<AsRead.Member> = {}): AsRead.Member => ({
  id,
  email: `${name.toLowerCase()}@example.com`,
  name,
  profile: '',
  role: 'member',
  status: 'active',
  createdAt: 1,
  character: null,
  ...fields,
})

export const me = (
  fields: Partial<AsRead.Me> = {},
  memberFields: Partial<AsRead.Member> = {},
): AsRead.Me => ({
  member: member(ANA, 'Ana', memberFields),
  credential: { id: 'cred_web000000000' as never, kind: 'human', name: 'Browser' },
  contactMode: 'open',
  ...fields,
})

export const entry = (
  id: MemberId,
  name: string,
  fields: Partial<AsRead.DirectoryEntry> = {},
): AsRead.DirectoryEntry => ({
  member: member(id, name),
  presence: { humanOnline: false, agentOnline: false },
  lastSeenAt: null,
  relation: 'none',
  canMessage: true,
  channels: [],
  ...fields,
})

export const note = (id: string, fields: Partial<AsRead.Note> = {}): AsRead.Note => ({
  id: id as NoteId,
  conversationId: ROOM,
  authorId: BEN,
  status: 'sent',
  body: `body of ${id}`,
  inReplyTo: null,
  origin: 'human',
  agentName: null,
  createdAt: 1,
  updatedAt: 1,
  sentAt: 1,
  receipts: [],
  ...fields,
})

export const draft = (id: string, fields: Partial<AsRead.Note> = {}): AsRead.Note =>
  note(id, { status: 'draft', sentAt: null, authorId: ANA, origin: 'agent', agentName: 'Laptop', ...fields })

export const conversation = (fields: Partial<AsRead.Conversation> = {}): AsRead.Conversation => ({
  id: ROOM,
  kind: 'direct',
  title: null,
  participantIds: [ANA, BEN],
  createdAt: 1,
  lastActivityAt: 1,
  lastNote: null,
  unreadCount: 0,
  draftCount: 0,
  archivedAt: null,
  ...fields,
})

export const channel = (slug: string, fields: Partial<AsRead.Channel> = {}): AsRead.Channel => ({
  slug,
  description: `About ${slug}`,
  conversationId: `conv_${slug.padEnd(12, '0')}` as ConversationId,
  visibility: 'open',
  memberCount: 3,
  helperCount: 1,
  joined: false,
  answering: false,
  managing: false,
  managedBy: `grp_${slug.padEnd(12, '0')}` as GroupId,
  createdAt: 1,
  ...fields,
})

/** A team unless the fields say otherwise; `managersOf` makes a channel's group. */
export const group = (id: GroupId, fields: Partial<AsRead.Group> = {}): AsRead.Group => ({
  id,
  kind: 'team',
  name: null,
  memberIds: [],
  channels: [],
  mayAdd: false,
  mayRemove: false,
  createdAt: 1,
  ...fields,
})

/** The group of a channel's managers, under the id the `channel` fixture gives it. */
export const managersOf = (slug: string, fields: Partial<AsRead.Group> = {}): AsRead.Group =>
  group(`grp_${slug.padEnd(12, '0')}` as GroupId, { kind: 'channel', channels: [slug], ...fields })

export const credential = (id: string, fields: Partial<AsRead.Credential> = {}): AsRead.Credential => ({
  id: id as never,
  kind: 'agent',
  name: id,
  client: 'Claude Code',
  createdAt: 1,
  expiresAt: 2,
  lastUsedAt: null,
  revokedAt: null,
  current: false,
  ...fields,
})

export const serverInfo = (features: Readonly<Record<string, boolean>> = {}): AsRead.ServerInfo => ({
  name: 'dovecote',
  version: '0.1.3',
  contactMode: 'open',
  signInWith: 'Google',
  features,
  protocolVersion: 1,
})

/** A server that offers every feature this client knows. */
export const everything = (): AsRead.ServerInfo =>
  serverInfo(
    Object.fromEntries(
      [
        'teaching',
        'agentFigures',
        'routeMap',
        'draftRequests',
        'channels',
        'groups',
        'characters',
        'debateRooms',
        'insights',
        'answeringFlow',
        'noteDetails',
        'webPush',
        'analytics',
      ].map((name) => [name, true]),
    ),
  )

export const principle = (topic: string, fields: Partial<AsRead.Principle> = {}): AsRead.Principle => ({
  id: `prin_${topic
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .padEnd(12, 'a')}` as AsRead.Principle['id'],
  kind: 'rule',
  topic,
  rule: `rule for ${topic}`,
  source: null,
  place: null,
  enabled: true,
  origin: 'manual',
  position: 0,
  createdAt: 1,
  updatedAt: 1,
  lastAppliedAt: null,
  publicText: null,
  counts: { applied: 0, sentAsWritten: 0, edited: 0, discarded: 0, missed: 0 },
  ...fields,
})

export const taught = (fields: Partial<AsRead.MyPrinciples> = {}): AsRead.MyPrinciples => ({
  principles: [],
  offers: [],
  routes: [],
  achievements: [],
  limit: 50,
  ...fields,
})

export const figures = (fields: Partial<AsRead.AgentFigures> = {}): AsRead.AgentFigures => ({
  written: 0,
  sentAsWritten: 0,
  sentAfterEdits: 0,
  discarded: 0,
  skipped: 0,
  skipReasons: [],
  expiredRequests: 0,
  medianDecisionMs: null,
  quickApprovals: 0,
  quickApprovalsFrequent: false,
  wroteYourself: 0,
  verdict: 'too_few',
  places: [],
  byClient: [],
  byModel: [],
  ...fields,
})

export const report = (fields: Partial<AsRead.AgentReport> = {}): AsRead.AgentReport => ({
  generatedAt: 0,
  quickApprovalSeconds: 3,
  minimumDecided: 10,
  periods: [
    { days: 7, current: figures(), previous: figures() },
    { days: 30, current: figures(), previous: figures() },
  ],
  weeks: [],
  sessions: { days: 30, byAge: [], byContext: [], latest: [] },
  ...fields,
})

export const debate = (fields: Partial<AsRead.Debate> = {}): AsRead.Debate => ({
  id: 'debate_000000000000' as AsRead.Debate['id'],
  question: 'Ship on Friday?',
  visibility: 'open',
  status: 'open',
  createdBy: ANA,
  createdAt: 1,
  deadlineAt: 2,
  concludedAt: null,
  closedAt: null,
  endedBecause: null,
  limits: { turnsPerAgent: 2, totalTurns: 4, minutes: 30, turnCharacters: 300 },
  memberIds: [ANA, BEN],
  participants: [],
  turns: [],
  result: null,
  resultRound: 0,
  ...fields,
})

export const summary = (fields: Partial<AsRead.DebateSummary> = {}): AsRead.DebateSummary => ({
  id: 'debate_000000000000' as AsRead.DebateSummary['id'],
  question: 'Ship on Friday?',
  visibility: 'open',
  status: 'open',
  createdBy: ANA,
  createdAt: 1,
  deadlineAt: 2,
  participantIds: [],
  turnCount: 0,
  resultDrafted: false,
  joined: true,
  ...fields,
})
