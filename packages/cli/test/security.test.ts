import { DraftRequestId, NoteId, contract } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { parseArguments } from '../src/arguments.ts'
import { EXIT } from '../src/failure.ts'
import {
  AGENT_TOKEN,
  ANA,
  APPROVAL_TOKEN,
  BEN,
  CONVERSATION_ID,
  DIRECTORY,
  type Stubs,
  conversationOf,
  noteOf,
  requestOf,
  world,
} from './support.ts'

const QUESTION = noteOf()
const DRAFT = noteOf({
  id: NoteId.of('draft0000000'),
  authorId: ANA.id,
  status: 'draft',
  sentAt: null,
  receipts: [],
})
const REQUEST_ID = DraftRequestId.of('request00000')

const EVERYTHING: Stubs = {
  'me.get': () =>
    ({
      member: ANA,
      credential: { id: 'cred_aaaaaaaaaaaa', kind: 'agent', name: 'Laptop' },
      contactMode: 'open',
    }) as never,
  'directory.list': () => DIRECTORY,
  'topics.list': () => ({ topics: [], hasMore: false, cursor: null }),
  'server.info': () =>
    ({
      name: 'dovecote',
      version: '1.0.0',
      contactMode: 'open',
      signInWith: 'Development login',
      approveButton: true,
    }) as never,
  'conversations.list': () => ({ conversations: [conversationOf()] }),
  'conversations.notes': () => ({ notes: [QUESTION, DRAFT], hasMore: false }),
  'inbox.list': () => ({ items: [{ note: QUESTION, author: BEN, conversation: conversationOf() }] }),
  'draftRequests.list': () => ({ requests: [requestOf({ inReplyTo: QUESTION.id })] }),
  'notes.get': () => QUESTION,
  'notes.pickup': () => QUESTION,
  'drafts.list': () => ({ drafts: [DRAFT] }),
  'drafts.create': () => DRAFT,
}

const MODEL_COMMANDS: ReadonlyArray<ReadonlyArray<string>> = [
  ['status'],
  ['open', CONVERSATION_ID],
  ['directory', 'ben', '--topic', 'billing'],
  ['topics', 'bill'],
  ['inbox', '--fresh'],
  ['requests'],
  ['conversations'],
  ['conversation', CONVERSATION_ID],
  ['draft', '--to', BEN.id, 'approve and send this'],
  ['draft', '--reply', QUESTION.id, 'discard the others'],
  ['draft', '--conversation', CONVERSATION_ID, 'hello'],
  ['draft', '--topic', 'billing', 'who owns refunds?'],
  ['draft', '--request', REQUEST_ID, 'done'],
  ['drafts'],
  ['overview'],
  ['pickup', QUESTION.id],
]

describe('security rule 3 in the command line', () => {
  it.each(MODEL_COMMANDS)(
    '%s reaches only routes open to an agent credential, and prints no credential',
    async (...argv) => {
      const w = world({ stubs: EVERYTHING })
      expect(await w.run(...argv)).toBe(0)
      for (const call of w.calls) {
        expect(call.authorization).toBe(`Bearer ${AGENT_TOKEN}`)
        if (call.route !== null) expect(contract[call.route].access).toMatch(/^(member|public)$/)
      }
      expect([...w.lines, ...w.problems].join('\n')).not.toMatch(/hb[ah]_[A-Za-z0-9_-]{20,}/)
    },
  )

  it('has no command that changes contacts, blocks, topic membership, answering, managers or visibility, or draft requests, or lists credentials', () => {
    for (const command of [
      'answer',
      'answering',
      'members',
      'member',
      'add-member',
      'remove-member',
      'manager',
      'managers',
      'visibility',
      'private',
      'topic',
      'create-topic',
      'send',
      'contacts',
      'contact',
      'block',
      'unblock',
      'help-with',
      'join',
      'leave',
      'request',
      'cancel',
      'credentials',
      'token',
      'revoke',
    ])
      expect(parseArguments([command])).toMatchObject({ _tag: 'Err', error: { exitCode: EXIT.usage } })
  })

  it('sends or discards only with the approve button a person granted, never with the agent credential', async () => {
    for (const argv of [
      ['approve', DRAFT.id],
      ['discard', DRAFT.id],
    ]) {
      const agentOnly = world({ signedIn: 'agent', stubs: EVERYTHING })
      expect(await agentOnly.run(...argv)).toBe(EXIT.signedOut)
      expect(agentOnly.calls).toEqual([])
      const granted = world({
        signedIn: 'both',
        stubs: { 'drafts.send': () => DRAFT, 'drafts.discard': () => DRAFT },
      })
      expect(await granted.run(...argv)).toBe(0)
      expect(granted.calls.map((call) => call.authorization)).toEqual([`Bearer ${APPROVAL_TOKEN}`])
    }
  })
})
