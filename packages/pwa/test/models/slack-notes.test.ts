import type { AsRead } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { authorshipOf } from '../../src/authorship.ts'
import { composerModel } from '../../src/models/composer.ts'
import { draftsItemModel } from '../../src/models/drafts-item.ts'
import { noteItemModel } from '../../src/models/note-item.ts'
import { postsToText } from '../../src/models/slack-reply.ts'
import { threadHeadModel } from '../../src/models/thread-room.ts'
import { timeShown } from '../../src/models/time.ts'
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
    const states = (['pending', 'posted', 'failed', 'unknown'] as const).map((posting) => {
      const reply = note('note_r', { posting, inReplyTo: 'note_q' as never })
      return noteItemModel(inChannel([question(), reply]), itemOf(reply)).slack
    })
    expect(states).toEqual([
      { text: strings.slack.postingToSlack, retry: null },
      { text: strings.slack.postedToSlack, retry: null },
      { text: strings.slack.notPostedToSlack, retry: strings.slack.tryAgain },
      null,
    ])
  })

  it('says when a waiting post is tried again, and offers to try it now', () => {
    const input = inChannel([])
    const at = input.now + 5 * 60_000
    const reply = note('note_r', { posting: 'retrying', postingRetryAt: at, inReplyTo: 'note_q' as never })
    expect(noteItemModel(inChannel([question(), reply]), itemOf(reply)).slack).toEqual({
      text: strings.slack.retryingAt({ time: timeShown(at, input.now).text }),
      retry: strings.slack.tryNow,
    })
    const undated = note('note_r', { posting: 'retrying', inReplyTo: 'note_q' as never })
    expect(noteItemModel(inChannel([question(), undated]), itemOf(undated)).slack?.text).toBe(
      strings.slack.retryingAt({ time: timeShown(input.now, input.now).text }),
    )
  })

  it('says a waiting post waits for Slack while Slack or the link is stopped', () => {
    const stopped = [billing({ link: { ...LINK, stoppedBecause: 'slack_stopped' } })]
    for (const posting of ['pending', 'retrying'] as const) {
      const reply = note('note_r', { posting, inReplyTo: 'note_q' as never })
      expect(noteItemModel(inChannel([question(), reply], stopped), itemOf(reply)).slack).toEqual({
        text: strings.slack.waitingForSlack,
        retry: null,
      })
    }
    const posted = note('note_r', { posting: 'posted', inReplyTo: 'note_q' as never })
    expect(noteItemModel(inChannel([question(), posted], stopped), itemOf(posted)).slack?.text).toBe(
      strings.slack.postedToSlack,
    )
  })
})

describe('a draft answering a question from Slack', () => {
  const answer = draft('note_d', { inReplyTo: 'note_q' as never })
  const itemOfDraft = { type: 'drafts' as const, key: 'd', inReplyTo: 'note_q' as never, drafts: [answer] }

  it('says where it is posted, and how many messages came in the thread since', () => {
    expect(draftsItemModel(inChannel([question()]), itemOfDraft).slack).toEqual({
      postsTo: strings.slack.postsTo({ channel: 'billing-help', count: 12 }),
      newer: null,
      edited: null,
    })
    expect(draftsItemModel(inChannel([question({ newerMessages: 2 })]), itemOfDraft).slack?.newer).toBe(
      strings.slack.newerMessages({ count: 2 }),
    )
  })

  it('says the question was edited in Slack after the oldest draft answering it was written', () => {
    const edited = question({ edited: true })
    const written = (updatedAt: number) => ({
      ...itemOfDraft,
      drafts: [draft('note_d', { inReplyTo: 'note_q' as never, updatedAt })],
    })
    const later = { ...edited, updatedAt: 50 }
    expect(draftsItemModel(inChannel([later]), written(10)).slack?.edited).toBe(strings.slack.questionEdited)
    expect(draftsItemModel(inChannel([later]), written(60)).slack?.edited).toBeNull()
    expect(
      draftsItemModel(inChannel([{ ...question(), updatedAt: 50 }]), written(10)).slack?.edited,
    ).toBeNull()
  })

  it('says nothing of Slack for a reply to a member', () => {
    const plain = { ...itemOfDraft, inReplyTo: 'note_m' as never }
    expect(draftsItemModel(inChannel([note('note_m')]), plain).slack).toBeNull()
  })

  it('says in the composer that the thread moved since, and never that a reply being typed is stale', () => {
    const replying = threadInput({
      conversations: [room],
      channels: [billing()],
      thread: { notes: [question({ newerMessages: 1, edited: true })], hasMore: false },
      replyTarget: 'note_q' as never,
    })
    const model = composerModel(replying)
    expect(model.kind === 'open' && model.slack).toEqual({
      postsTo: strings.slack.postsTo({ channel: 'billing-help', count: 12 }),
      newer: strings.slack.newerMessages({ count: 1 }),
      edited: null,
    })
  })

  it('says where a reply typed in the composer goes, without a count the link does not know', () => {
    const replying = threadInput({
      conversations: [room],
      channels: [billing({ link: { ...LINK, memberCount: null } })],
      thread: { notes: [question()], hasMore: false },
      replyTarget: 'note_q' as never,
    })
    const model = composerModel(replying)
    expect(model.kind === 'open' && model.slack).toEqual({
      postsTo: strings.slack.postsToUncounted({ channel: 'billing-help' }),
      newer: null,
      edited: null,
    })
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
      slackLink: { text: strings.slack.linkStoppedBecause.unknown({ channel: 'billing-help' }) },
    })
    expect(head({ link: null })).toMatchObject({ slackLink: null })
  })

  it('says why a link stopped and how to restart it, and when Slack stopped on the server', () => {
    const head = (link: Partial<NonNullable<AsRead.Channel['link']>>) =>
      threadHeadModel(
        threadInput({ conversations: [room], channels: [billing({ link: { ...LINK, ...link } })] }),
      )
    const values = { channel: 'billing-help' }
    const because = strings.slack.linkStoppedBecause
    const cases = [
      [{ state: 'stopped', stoppedBecause: 'app_removed' }, because.appRemoved(values)],
      [{ state: 'stopped', stoppedBecause: 'archived' }, because.archived(values)],
      [{ state: 'stopped', stoppedBecause: 'deleted' }, because.deleted(values)],
      [{ state: 'stopped', stoppedBecause: 'failures' }, because.failures(values)],
      [{ state: 'stopped', stoppedBecause: 'pairing' }, because.unknown(values)],
      [{ state: 'stopped', stoppedBecause: 'unknown' }, because.unknown(values)],
      [{ state: 'stopped', stoppedBecause: null }, because.unknown(values)],
      [{ state: 'active', stoppedBecause: 'slack_stopped' }, because.slackStopped(values)],
      [{ state: 'active', stoppedBecause: null }, strings.slack.linkedChannel(values)],
    ] as const
    for (const [link, text] of cases) expect(head(link)).toMatchObject({ slackLink: { text } })
    expect(because.appRemoved(values)).toContain('with the word link')
  })
})
