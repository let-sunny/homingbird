import { describe, expect, it } from 'vitest'
import {
  archiveDiscardLines,
  isOn,
  mayMessageIn,
  nameIn,
  noteIn,
  notesOf,
  roomOf,
  threadHeadModel,
  threadTopModel,
} from '../../src/models/thread-room.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, ROOM, channel, conversation, entry, note, serverInfo } from '../support/fixtures.ts'
import { threadInput } from '../support/thread.ts'

describe('reading the conversation', () => {
  it('finds its notes, a note by id, its room, names and features', () => {
    const first = note('n1')
    const input = threadInput({ thread: { notes: [first], hasMore: false } })
    expect(notesOf(input)).toEqual([first])
    expect(notesOf(threadInput({ thread: undefined }))).toEqual([])
    expect(noteIn(input, 'n1')).toBe(first)
    expect(noteIn(input, null)).toBeNull()
    expect(roomOf(input)?.id).toBe(ROOM)
    expect(nameIn(input, BEN)).toBe('Ben')
    expect(nameIn(input, CY)).toBe(strings.formerMember)
    expect(isOn(input, 'teaching')).toBe(true)
    expect(isOn(threadInput({ serverInfo: serverInfo() }), 'teaching')).toBe(false)
  })
})

describe('threadTopModel', () => {
  it('waits for notes, offers older ones, and says what to do in an empty conversation or channel room', () => {
    expect(threadTopModel(threadInput({ thread: undefined }))).toEqual({ kind: 'loading' })
    expect(threadTopModel(threadInput({ thread: { notes: [], hasMore: true } }))).toEqual({
      kind: 'older',
      label: strings.loadOlder,
    })
    expect(threadTopModel(threadInput({ thread: { notes: [note('n1')], hasMore: false } }))).toEqual({
      kind: 'none',
    })
    expect(threadTopModel(threadInput())).toEqual({ kind: 'empty', text: strings.emptyThread })
    expect(threadTopModel(threadInput({ conversations: [conversation({ kind: 'channel' })] }))).toEqual({
      kind: 'empty',
      text: strings.channelRoomEmpty,
    })
  })

  it('tells the asker, at the top and in the head, who else reads a private question', () => {
    const asked = conversation({ kind: 'group', privateQuestionOf: 'wiki', participantIds: [ANA, BEN] })
    const input = threadInput({ conversations: [asked] })
    const notice = strings.channelAgent.privateNotice({ agent: '#wiki', channel: '#wiki' })
    expect(threadTopModel(input)).toEqual({ kind: 'empty', text: notice })
    expect(threadHeadModel(input)).toMatchObject({ kind: 'people', profile: notice })
  })
})

describe('archiveDiscardLines', () => {
  it('says which channel’s archiving discarded each draft', () => {
    expect(archiveDiscardLines([{ noteId: 'n1' as never, channel: 'billing' }])).toEqual([
      { noteId: 'n1', text: strings.draftDiscardedByArchive({ channel: '#billing' }) },
    ])
  })
})

describe('threadHeadModel', () => {
  it('waits for the conversation, then names the other person with their profile and presence', () => {
    expect(threadHeadModel(threadInput({ conversations: [] }))).toEqual({
      kind: 'loading',
      title: strings.loading,
    })
    const presence = { humanOnline: true, agentOnline: true }
    const ben = entry(BEN, 'Ben', { presence })
    expect(
      threadHeadModel(
        threadInput({ directory: [{ ...ben, member: { ...ben.member, profile: 'Billing.' } }] }),
      ),
    ).toEqual({
      kind: 'people',
      title: 'Ben',
      profile: 'Billing.',
      presence,
    })
    expect(threadHeadModel(threadInput())).toEqual({
      kind: 'people',
      title: 'Ben',
      profile: null,
      presence: null,
    })
    expect(
      threadHeadModel(
        threadInput({ conversations: [conversation({ kind: 'group', title: 'Team' })], directory: [ben] }),
      ),
    ).toEqual({
      kind: 'people',
      title: 'Team',
      profile: null,
      presence: null,
    })
  })

  it('shows a channel room with its channel, and an archived room without one', () => {
    const billing = channel('billing', { conversationId: ROOM })
    expect(
      threadHeadModel(
        threadInput({
          conversations: [conversation({ kind: 'channel', title: 'billing' })],
          channels: [billing],
        }),
      ),
    ).toEqual({
      kind: 'channel',
      title: '#billing',
      archived: false,
      channel: billing,
    })
    expect(
      threadHeadModel(threadInput({ conversations: [conversation({ archivedAt: 5 })], channels: [billing] })),
    ).toMatchObject({
      kind: 'channel',
      archived: true,
      channel: null,
    })
  })
})

describe('mayMessageIn', () => {
  it('stops a note to someone who does not take the person’s notes, and nowhere else', () => {
    expect(mayMessageIn(threadInput({ directory: [entry(BEN, 'Ben', { canMessage: false })] }))).toBe(false)
    expect(mayMessageIn(threadInput({ directory: [entry(BEN, 'Ben')] }))).toBe(true)
    expect(mayMessageIn(threadInput())).toBe(true)
    expect(mayMessageIn(threadInput({ conversations: [] }))).toBe(true)
    expect(
      mayMessageIn(
        threadInput({ conversations: [conversation({ kind: 'group', participantIds: [ANA, BEN, CY] })] }),
      ),
    ).toBe(true)
  })
})
