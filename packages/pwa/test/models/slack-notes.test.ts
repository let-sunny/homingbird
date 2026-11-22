import type { AsRead } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { authorshipOf } from '../../src/authorship.ts'
import { composerModel, postsToText } from '../../src/models/composer.ts'
import { draftsItemModel } from '../../src/models/drafts-item.ts'
import { noteItemModel } from '../../src/models/note-item.ts'
import { threadHeadModel } from '../../src/models/thread-room.ts'
import { strings } from '../../src/strings.ts'
import { ROOM, channel, conversation, draft, note } from '../support/fixtures.ts'
import { threadInput } from '../support/thread.ts'

const VIA: NonNullable<AsRead.Note['via']> = {
  tool: 'slack',
  askerName: 'Bob',
  askerId: null,
  channelName: 'billing-help',
  edited: false,
  deleted: false,
  threadAt: '1.0',
  newerMessages: 0,
}

const LINK: NonNullable<AsRead.Channel['link']> = {
  tool: 'slack',
  name: 'billing-help',
  isPrivate: false,
  memberCount: 12,
  state: 'active',
}

const room = conversation({ kind: 'channel' })
const billing = (fields: Partial<AsRead.Channel> = {}) =>
  channel('billing', { conversationId: ROOM, joined: true, link: LINK, ...fields })
const question = (via: Partial<AsRead.Note['via'] & object> = {}) =>
  note('note_q', { origin: 'outside', via: { ...VIA, ...via } })

const itemOf = (shown: AsRead.Note) => ({
  type: 'note' as const,
  key: shown.id,
  note: shown,
  leadsRun: true,
  next: null,
})

const inChannel = (notes: ReadonlyArray<AsRead.Note>, channels = [billing()]) =>
  threadInput({ conversations: [room], channels, thread: { notes, hasMore: false } })

describe('a note from Slack in the thread', () => {
  it('is named by its asker and channel, says nobody approved it, and carries no agent mark', () => {
    const shown = question()
    const model = noteItemModel(inChannel([shown]), itemOf(shown))
    expect(authorshipOf(shown)).toBe('outside')
    expect(model.authorName).toBe(strings.slack.askedIn({ name: 'Bob', channel: 'billing-help' }))
    expect(model.author?.line).toBe(strings.slack.askedInLine({ name: 'Bob', channel: 'billing-help' }))
    expect(model.author?.agentMark).toBe(false)
    expect(model.slack).toBeNull()
  })

  it('names an arrival without its Slack facts by the link', () => {
    const shown = note('note_q', { origin: 'outside' })
    const model = noteItemModel(inChannel([shown]), itemOf(shown))
    expect(model.author?.line).toBe(strings.slack.askedInLine({ name: 'Ben', channel: '' }))
  })

  it('says a copy was edited or deleted in Slack', () => {
    const edited = question({ edited: true })
    expect(noteItemModel(inChannel([edited]), itemOf(edited)).slack).toEqual({
      text: strings.slack.editedInSlack,
      retry: null,
    })
    const deleted = question({ edited: true, deleted: true })
    expect(noteItemModel(inChannel([deleted]), itemOf(deleted)).slack?.text).toBe(
      strings.slack.deletedInSlack,
    )
  })

  it('says how a reply’s post stands, with Try again when it failed', () => {
    const states = (['pending', 'posted', 'failed'] as const).map((posting) => {
      const reply = note('note_r', { posting, inReplyTo: 'note_q' as never })
      return noteItemModel(inChannel([question(), reply]), itemOf(reply)).slack
    })
    expect(states).toEqual([
      { text: strings.slack.postingToSlack, retry: null },
      { text: strings.slack.postedToSlack, retry: null },
      { text: strings.slack.notPostedToSlack, retry: strings.slack.tryAgain },
    ])
  })
})

describe('a draft answering a question from Slack', () => {
  const answer = draft('note_d', { inReplyTo: 'note_q' as never })
  const itemOfDraft = { type: 'drafts' as const, key: 'd', inReplyTo: 'note_q' as never, drafts: [answer] }

  it('says where it is posted, and how many messages came in the thread since', () => {
    expect(draftsItemModel(inChannel([question()]), itemOfDraft).slack).toEqual({
      postsTo: strings.slack.postsTo({ channel: 'billing-help', count: 12 }),
      newer: null,
    })
    expect(draftsItemModel(inChannel([question({ newerMessages: 2 })]), itemOfDraft).slack?.newer).toBe(
      strings.slack.newerMessages({ count: 2 }),
    )
  })

  it('says nothing of Slack for a reply to a member', () => {
    const plain = { ...itemOfDraft, inReplyTo: 'note_m' as never }
    expect(draftsItemModel(inChannel([note('note_m')]), plain).slack).toBeNull()
  })

  it('says where a reply typed in the composer goes, without a count the link does not know', () => {
    const replying = threadInput({
      conversations: [room],
      channels: [billing({ link: { ...LINK, memberCount: null } })],
      thread: { notes: [question()], hasMore: false },
      replyTarget: 'note_q' as never,
    })
    const model = composerModel(replying)
    expect(model.kind === 'open' && model.postsTo).toBe(
      strings.slack.postsToUncounted({ channel: 'billing-help' }),
    )
    expect(postsToText('billing-help', undefined)).toBe(
      strings.slack.postsToUncounted({ channel: 'billing-help' }),
    )
  })
})

describe('a channel linked to Slack, in its head', () => {
  it('says what the link does, and offers its managers to unlink it', () => {
    const head = (fields: Partial<AsRead.Channel>) =>
      threadHeadModel(threadInput({ conversations: [room], channels: [billing(fields)] }))
    expect(head({})).toMatchObject({
      slackLink: { text: strings.slack.linkedChannel({ channel: 'billing-help' }), unlink: null },
    })
    expect(head({ managing: true })).toMatchObject({ slackLink: { unlink: strings.slack.unlinkChannel } })
    expect(head({ link: { ...LINK, state: 'stopped' } })).toMatchObject({
      slackLink: { text: strings.slack.linkStopped({ channel: 'billing-help' }) },
    })
    expect(head({ link: null })).toMatchObject({ slackLink: null })
  })
})
