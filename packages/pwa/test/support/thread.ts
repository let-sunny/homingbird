import type { ThreadInput } from '../../src/models/thread-room.ts'
import { ANA, BEN, ROOM, conversation, everything, me, member } from './fixtures.ts'

/** A conversation between Ana, who reads it, and Ben, on a server that offers everything. */
export const threadInput = (fields: Partial<ThreadInput> = {}): ThreadInput => ({
  me: me(),
  conversationId: ROOM,
  thread: { notes: [], hasMore: false },
  draftsRead: new Map(),
  conversations: [conversation()],
  channels: [],
  members: new Map([
    [ANA, member(ANA, 'Ana')],
    [BEN, member(BEN, 'Ben')],
  ]),
  directory: [],
  releases: new Map(),
  archiveDiscards: [],
  replyTarget: null,
  draftRequests: [],
  taught: null,
  agentReport: null,
  serverInfo: everything(),
  sending: false,
  now: 10,
  focusedDraft: null,
  ...fields,
})
