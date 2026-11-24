import { Task as T } from '@homingbird/kernel'
import type { ApiError } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import type { Action } from '../../src/app.ts'
import { updateProfile, useCharacter } from '../../src/tasks/account.ts'
import { resetMemberCharacter } from '../../src/tasks/admin.ts'
import {
  askPrivately,
  createChannelAgent,
  discardReview,
  disconnectAgentDesk,
  renameChannelAgent,
  retireChannelAgent,
  sendReview,
} from '../../src/tasks/channel-agents.ts'
import {
  addTeam,
  archiveChannel,
  askChannel,
  createChannel,
  createChannelThen,
  enterRoom,
  joinChannel,
  leaveChannel,
  reviseChannel,
  setAnswering,
  setChannelMember,
} from '../../src/tasks/channels.ts'
import { acceptSuggestion } from '../../src/tasks/debate-suggestions.ts'
import { createDebate, createSchedulingRoom } from '../../src/tasks/debates.ts'
import { approveDraft, discardDraft, readdressDraft } from '../../src/tasks/drafts.ts'
import { createGroup, deleteGroup, renameGroup, setGroupMembers } from '../../src/tasks/groups.ts'
import { recallNote, sendNote } from '../../src/tasks/notes.ts'
import {
  acceptContact,
  blockMember,
  removeContact,
  requestContact,
  unblockMember,
} from '../../src/tasks/people.ts'
import { reloadQuietly } from '../../src/tasks/quiet-reload.ts'
import { retrySchedulingRoom } from '../../src/tasks/scheduling.ts'
import { fail, settle, testApp } from '../support/app.ts'
import {
  ANA,
  BEN,
  ROOM,
  TEAM,
  channel,
  debate,
  draft,
  everything,
  member,
  note,
} from '../support/fixtures.ts'

const unavailable: ApiError = { _tag: 'Unavailable', message: 'down' }
const signedOut: ApiError = { _tag: 'Unauthorized', message: 'Sign in again.' }

const RELOADS = [
  'conversations.list',
  'conversations.get',
  'conversations.notes',
  'directory.list',
  'contacts.list',
  'channels.list',
  'channels.agent.get',
  'groups.list',
  'reviews.list',
  'debates.list',
]

/** Every route a change reads again answers with the refusal; the change's own route answers as given. */
const reloadsRefused = (refusal: ApiError, accepted: Record<string, () => unknown>) => ({
  ...Object.fromEntries(RELOADS.map((route) => [route, () => fail(refusal)])),
  ...accepted,
})

const agentReview = {
  note: draft('note_answer00000'),
  question: note('note_question000'),
  channel: 'payments-wiki',
  agent: member(BEN, 'Payments wiki', { kind: 'channel_agent' }),
  privately: false,
}

/** What the server accepted, the action that asks for it, and the reloads it runs after. */
const accepted: ReadonlyArray<readonly [string, Record<string, () => unknown>, Action<unknown>]> = [
  ['sending a note', sendRoutes(), sendNote(ROOM, 'Yes')],
  ['approving a draft', sendRoutes(), approveDraft(draft('d1'), null, [])],
  ['discarding a draft', {}, discardDraft(draft('d1'))],
  ['readdressing a draft', { 'drafts.update': () => draft('d1') }, readdressDraft(draft('d1'), 'billing')],
  ['recalling a note', { 'notes.recall': () => note('n1') }, recallNote(note('n1'))],
  ['sending a review', sendRoutes(), sendReview(agentReview, null)],
  ['discarding a review', {}, discardReview(agentReview, '')],
  ['making a channel agent', {}, createChannelAgent('billing', 'Desk')],
  ['renaming a channel agent', {}, renameChannelAgent('billing', 'Desk')],
  ['retiring a channel agent', {}, retireChannelAgent('billing')],
  ['disconnecting an agent desk', {}, disconnectAgentDesk('billing', 'cred_desk00000000' as never)],
  [
    'asking a channel agent privately',
    { 'channels.askPrivately': () => ({ id: ROOM }) },
    askPrivately('billing'),
  ],
  ['opening a channel', { 'channels.create': () => channel('ops') }, createChannel('ops', 'Ops', 'open')],
  [
    'opening a channel and a next step',
    { 'channels.create': () => channel('ops') },
    createChannelThen({ slug: 'ops', description: 'Ops' }, () => T.unit),
  ],
  ['joining a channel', {}, joinChannel('billing', true)],
  ['leaving a channel', {}, leaveChannel('billing')],
  ['answering in a channel', {}, setAnswering('billing', true)],
  ['adding a channel member', {}, setChannelMember('billing', BEN, true)],
  ['adding a team to a channel', {}, addTeam('billing', TEAM)],
  ['revising a channel', {}, reviseChannel('billing', { description: 'New' })],
  ['archiving a channel', {}, archiveChannel('billing', null)],
  ['asking a channel', sendRoutes(), askChannel('billing', 'When?')],
  ['entering a room', {}, enterRoom(ROOM)],
  ['renaming a group', {}, renameGroup(TEAM, 'Finance')],
  ['setting a group’s members', {}, setGroupMembers(TEAM, [BEN])],
  ['making a group', { 'admin.groups.create': () => ({ id: TEAM }) }, createGroup('Finance')],
  ['deleting a group', {}, deleteGroup(TEAM)],
  ['requesting a contact', {}, requestContact(BEN)],
  ['accepting a contact', {}, acceptContact(BEN)],
  ['removing a contact', {}, removeContact(BEN)],
  ['blocking a member', {}, blockMember(BEN)],
  ['unblocking a member', {}, unblockMember(BEN)],
  [
    'resetting a character',
    { 'admin.members.resetCharacter': () => member(BEN, 'Ben') },
    resetMemberCharacter(BEN),
  ],
  ['updating the profile', { 'me.update': () => member(ANA, 'Ana') }, updateProfile('Ana', '')],
  ['using a character', { 'me.character.clear': () => member(ANA, 'Ana') }, useCharacter(null)],
  ['opening a flock', { 'debates.create': () => debate() }, createDebate(wish())],
  ['opening a scheduling flock', { 'scheduling.create': () => debate() }, createSchedulingRoom(setup())],
  [
    'retrying a scheduling flock',
    { 'scheduling.retry': () => debate() },
    retrySchedulingRoom(debate().id, null),
  ],
  [
    'accepting a flock suggestion',
    { 'debateSuggestions.accept': () => debate() },
    acceptSuggestion('sug_000000000000' as never, { question: 'Ship?', memberIds: [] }),
  ],
]

describe('a change the server accepted', () => {
  it.each(accepted)(
    'is not reported as failed when only what is read again after %s fails',
    async (_, answers, action) => {
      const app = testApp(reloadsRefused(unavailable, answers))
      app.state.serverInfo.set(everything())
      const outcome = await app.run(action)
      expect(outcome._tag).toBe('Ok')
      expect(app.routes().some((route) => RELOADS.includes(route))).toBe(true)
    },
  )

  it.each(accepted)(
    'still ends the session when what is read again after %s says it ended',
    async (_, answers, action) => {
      const app = testApp(reloadsRefused(signedOut, answers))
      app.state.serverInfo.set(everything())
      app.app.launch(action)
      for (let round = 0; round < 5; round++) await settle()
      expect(app.app.ended.aborted).toBe(true)
    },
  )
})

describe('reloading quietly', () => {
  it('lets a reload that works run, and drops the failure of one that does not', async () => {
    const app = testApp()
    expect((await app.run(reloadQuietly(T.unit)))._tag).toBe('Ok')
    expect((await app.run(reloadQuietly(T.fail(unavailable))))._tag).toBe('Ok')
  })

  it('passes on a refusal of the session, which ends it', async () => {
    const outcome = await testApp().run(reloadQuietly(T.fail(signedOut)))
    expect(outcome).toMatchObject({ _tag: 'Err', error: { error: signedOut } })
  })
})

function sendRoutes(): Record<string, () => unknown> {
  return {
    'drafts.create': () => note('d1', { status: 'draft', authorId: ANA }),
    'drafts.send': () => note('d1', { conversationId: ROOM }),
  }
}

function wish() {
  return { question: 'Ship?', visibility: 'open' as const, limits: {} as never, memberIds: [] }
}

function setup() {
  return {
    title: 'Sync',
    minutes: 30,
    window: { startsAt: 1, endsAt: 2 },
    attendees: [],
  }
}
