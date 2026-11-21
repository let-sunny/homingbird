import { describe, expect, it } from 'vitest'
import {
  archiveDiscardLines,
  channelAskedIn,
  isFocusedDraftOpen,
  isOn,
  mayMessageIn,
  nameIn,
  noteIn,
  notesOf,
  roomOf,
  settledDraftLine,
  threadHeadModel,
  threadTopModel,
} from '../../src/models/thread-room.ts'
import { strings } from '../../src/strings.ts'
import {
  ANA,
  BEN,
  CY,
  ROOM,
  channel,
  conversation,
  draft,
  entry,
  everything,
  note,
  serverInfo,
} from '../support/fixtures.ts'
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

describe('channelAskedIn', () => {
  it('finds the channel a private question asks, and none for a direct room or a channel no longer listed', () => {
    const wiki = channel('wiki')
    const asked = conversation({ kind: 'group', privateQuestionOf: 'wiki', participantIds: [ANA, BEN] })
    expect(channelAskedIn(threadInput({ conversations: [asked], channels: [wiki] }))).toBe(wiki)
    expect(channelAskedIn(threadInput({ conversations: [asked], channels: [] }))).toBeNull()
    expect(channelAskedIn(threadInput({ channels: [wiki] }))).toBeNull()
  })
})

describe('settledDraftLine', () => {
  it('says the draft a notification opened was settled once the thread shows it is not open', () => {
    const shownWith = (notes: ReturnType<typeof note>[], focusedDraft: string | null = 'd1') =>
      settledDraftLine(threadInput({ thread: { notes, hasMore: false }, focusedDraft }), false)
    expect(settledDraftLine(threadInput({ thread: undefined, focusedDraft: 'd1' }), false)).toBeNull()
    expect(shownWith([draft('d1')])).toBeNull()
    expect(shownWith([draft('d2')], null)).toBeNull()
    expect(shownWith([note('d1')])).toBe(strings.draftAlreadySettled)
    expect(shownWith([draft('d2')])).toBe(strings.draftAlreadySettled)
  })

  it('says nothing once the page showed the draft open, since the person settled it here', () => {
    const sent = threadInput({ thread: { notes: [note('d1')], hasMore: false }, focusedDraft: 'd1' })
    expect(settledDraftLine(sent, true)).toBeNull()
    expect(
      isFocusedDraftOpen(
        threadInput({ thread: { notes: [draft('d1')], hasMore: false }, focusedDraft: 'd1' }),
      ),
    ).toBe(true)
    expect(isFocusedDraftOpen(sent)).toBe(false)
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
      presence: {
        person: { isOn: true, label: strings.presenceOf.online({ name: 'Ben' }) },
        agent: { state: 'on', label: strings.presenceOf.agentAwake({ name: 'Ben' }) },
      },
      people: null,
      mute: expect.objectContaining({ conversationId: ROOM, muted: false, label: 'Mute Ben' }),
    })
    expect(threadHeadModel(threadInput())).toEqual({
      kind: 'people',
      title: 'Ben',
      profile: null,
      presence: null,
      people: null,
      mute: expect.objectContaining({ muted: false }),
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
      people: {
        label: strings.groupPeople({ count: 2 }),
        title: strings.groupPeopleTitle,
        people: [
          { name: 'Ana', you: true },
          { name: 'Ben', you: false },
        ],
      },
      mute: expect.objectContaining({ label: 'Mute Team' }),
    })
  })

  it('offers to mute the conversation, or to lift its mute, only while the server offers muting', () => {
    expect(threadHeadModel(threadInput({ conversations: [conversation({ muted: true })] }))).toMatchObject({
      mute: { muted: true, mark: strings.mute.muted, label: 'Unmute Ben' },
    })
    expect(threadHeadModel(threadInput({ serverInfo: serverInfo({ mute: false }) }))).toMatchObject({
      kind: 'people',
      mute: null,
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
      agentState: null,
      mute: expect.objectContaining({ label: 'Mute #billing' }),
    })
    const helped = channel('billing', {
      conversationId: ROOM,
      agent: {
        id: BEN,
        name: 'Billing helper',
        presence: { humanOnline: false, agentOnline: true, agentUnavailable: { until: null } },
      },
    })
    const withAgent = (info: ReturnType<typeof everything>) =>
      threadHeadModel(
        threadInput({
          conversations: [conversation({ kind: 'channel', title: 'billing' })],
          channels: [helped],
          serverInfo: info,
        }),
      )
    expect(withAgent(everything())).toMatchObject({
      agentState: {
        state: 'unavailable',
        label: strings.channelAgentState.unavailable({ agent: 'Billing helper' }),
      },
    })
    expect(withAgent(serverInfo())).toMatchObject({ agentState: null })
    expect(
      threadHeadModel(threadInput({ conversations: [conversation({ archivedAt: 5 })], channels: [billing] })),
    ).toMatchObject({
      kind: 'channel',
      archived: true,
      channel: null,
      mute: null,
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
