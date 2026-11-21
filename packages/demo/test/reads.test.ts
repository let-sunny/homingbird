import { makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import {
  channelAsSeen,
  conversationsOf,
  directoryOf,
  groupsOf,
  isParticipant,
  mayRead,
  notesSeenIn,
  reviewOf,
  reviewsOf,
} from '../src/reads.ts'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, memberNamed, noteStarting } from './support/demo.ts'

const fresh = () => {
  const world = createWorld(makeTestClock(NOW))
  return {
    world,
    records: world.records(),
    june: VISITOR_ID,
    ana: memberNamed(world, 'Ana Silva'),
    ben: memberNamed(world, 'Ben Okafor'),
    kai: memberNamed(world, 'Kai Lin'),
  }
}

describe('mayRead', () => {
  it('shows a draft to its author and hides it from the person it answers (rule 2)', () => {
    const { records, june, ana } = fresh()
    const reply = noteStarting(createWorld(makeTestClock(NOW)), 'Yes. I checked')
    expect(mayRead(records, june, reply)).toBe(true)
    expect(mayRead(records, ana, reply)).toBe(false)
  })

  it('shows a channel’s agent’s answer to a manager who did not ask, never to the asker or a member', () => {
    const { world, records, june, ana, ben, kai } = fresh()
    const answer = noteStarting(world, 'Annual plans are refunded')
    expect(mayRead(records, june, answer)).toBe(true)
    expect(mayRead(records, ana, answer)).toBe(true)
    expect(mayRead(records, ben, answer)).toBe(false)
    expect(mayRead(records, kai, answer)).toBe(false)
  })

  it('shows a sent note only to the people in its conversation', () => {
    const { world, records, june, ben } = fresh()
    const question = noteStarting(world, 'Is the billing migration safe')
    expect(mayRead(records, june, question)).toBe(true)
    expect(mayRead(records, ben, question)).toBe(false)
    expect(isParticipant(records, ben, question.conversationId)).toBe(false)
  })
})

describe('reviewOf', () => {
  it('leaves out a manager who asked the question the answer is for', () => {
    const { world, records, ana } = fresh()
    const answer = noteStarting(world, 'Annual plans are refunded')
    const askedByAna = {
      ...records,
      notes: records.notes.map((note) => (note.id === answer.inReplyTo ? { ...note, authorId: ana } : note)),
    }
    expect(reviewOf(askedByAna, ana, answer)).toBeNull()
    expect(reviewsOf(records, ana).map((review) => review.note.id)).toEqual([answer.id])
  })

  it('reads the question with the answer, and nothing for a person’s own draft', () => {
    const { world, records, june } = fresh()
    const [review] = reviewsOf(records, june)
    expect(review?.question?.body).toMatch(/^Who can explain/)
    expect(review?.channel).toBe('billing')
    expect(reviewOf(records, june, noteStarting(world, 'Yes. I checked'))).toBeNull()
  })
})

describe('conversationsOf', () => {
  it('lists the viewer’s conversations, the most recent first, with their unread notes and own drafts', () => {
    const { records, june, ben } = fresh()
    const listed = conversationsOf(records, june)
    expect(listed[0]?.participantIds).toContain(memberNamed(createWorld(makeTestClock(NOW)), 'Ana Silva'))
    expect(listed[0]?.draftCount).toBe(1)
    expect(
      listed.find(
        (room) =>
          room.kind === 'direct' &&
          room.participantIds.includes(memberNamed(createWorld(makeTestClock(NOW)), 'Kai Lin')),
      )?.unreadCount,
    ).toBe(2)
    expect(listed.every((room) => room.participantIds.includes(june))).toBe(true)
    expect(conversationsOf(records, ben).some((room) => room.draftCount > 0)).toBe(false)
  })

  it('shows a direct conversation only once a note in it is sent, or to the author of its draft', () => {
    const { world, june, ana } = fresh()
    const reply = noteStarting(world, 'Yes. I checked')
    world.update((records) => ({
      ...records,
      notes: records.notes.filter(
        (note) => note.conversationId !== reply.conversationId || note.id === reply.id,
      ),
    }))
    expect(conversationsOf(world.records(), june).some((room) => room.id === reply.conversationId)).toBe(true)
    expect(conversationsOf(world.records(), ana).some((room) => room.id === reply.conversationId)).toBe(false)
  })
})

describe('notesSeenIn', () => {
  it('reads the sent notes oldest first, then the viewer’s own drafts, and no one else’s', () => {
    const { world, records, june, ana } = fresh()
    const room = noteStarting(world, 'Yes. I checked').conversationId
    const seen = notesSeenIn(records, june, room)
    expect(seen.map((note) => note.status)).toEqual(['sent', 'sent', 'sent', 'draft'])
    expect(notesSeenIn(records, ana, room).map((note) => note.status)).toEqual(['sent', 'sent', 'sent'])
    const billing = noteStarting(world, 'Annual plans are refunded').conversationId
    expect(notesSeenIn(records, june, billing).some((note) => note.status === 'draft')).toBe(false)
  })
})

describe('channelAsSeen', () => {
  it('counts the people in the room, not its agent, and says whether the viewer manages it', () => {
    const { records, june, kai } = fresh()
    const billing = records.channels.find((channel) => channel.slug === 'billing')!
    expect(channelAsSeen(records, june, billing)).toMatchObject({
      memberCount: 4,
      helperCount: 2,
      joined: true,
      answering: true,
      managing: true,
      runsAgent: true,
      agent: { name: 'Billing helper' },
    })
    expect(channelAsSeen(records, kai, billing)).toMatchObject({ managing: false, answering: false })
  })
})

describe('directoryOf', () => {
  it('lists the people by name, never a channel’s agent, and finds them by what they wrote', () => {
    const { records, june } = fresh()
    const everyone = directoryOf(records, june, {})
    expect(everyone.map((entry) => entry.member.name)).toEqual([
      'Ana Silva',
      'Ben Okafor',
      'June Park',
      'Kai Lin',
      'Maximiliana Konstantinopoulou-Vanderbilt-Oyelaran',
    ])
    expect(everyone.find((entry) => entry.member.id === june)).toMatchObject({
      relation: 'self',
      canMessage: false,
    })
    expect(everyone.find((entry) => entry.member.name === 'Ana Silva')).toMatchObject({
      relation: 'none',
      canMessage: true,
    })
    expect(directoryOf(records, june, { q: 'refunds' }).map((entry) => entry.member.name)).toEqual([
      'Ana Silva',
      'Ben Okafor',
    ])
  })

  it('narrows to a channel’s answerers or a team, and introduces the visitor’s agent by its public sentences', () => {
    const { records, june } = fresh()
    const team = records.groups.find((group) => group.name === 'Platform')!
    expect(directoryOf(records, june, { channel: 'billing' }).map((entry) => entry.member.name)).toEqual([
      'Ana Silva',
      'June Park',
    ])
    expect(directoryOf(records, june, { group: team.id }).map((entry) => entry.member.name)).toEqual([
      'June Park',
      'Kai Lin',
    ])
    expect(directoryOf(records, june, { q: 'June' })[0]?.agentIntroduction).toEqual([
      'Says what it checked before calling a change safe.',
    ])
  })
})

describe('groupsOf', () => {
  it('names each channel a group manages, and lets only its own members change it', () => {
    const { records, june, kai } = fresh()
    const billing = groupsOf(records, june).find((group) => group.channels.includes('billing'))
    expect(billing).toMatchObject({ kind: 'channel', mayAdd: true, mayRemove: true })
    expect(groupsOf(records, kai).find((group) => group.id === billing?.id)).toMatchObject({ mayAdd: false })
    expect(groupsOf(records, june).find((group) => group.kind === 'team')?.mayAdd).toBe(false)
  })
})
