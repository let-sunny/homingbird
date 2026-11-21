import {
  ConversationId,
  CredentialId,
  Debate,
  GroupId,
  Member,
  MemberId,
  Note,
  Principle,
  isPerson,
} from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { VISITOR_ID, VISITOR_SESSION, demoTeam } from '../src/team.ts'
import { NOW } from './support/demo.ts'

const team = demoTeam(NOW)

describe('demoTeam', () => {
  it('reads as the contract’s own records, every one of them', () => {
    for (const { member } of team.members) expect(Member.decode(member)._tag).toBe('Ok')
    for (const note of team.notes) expect(Note.decode(note)._tag).toBe('Ok')
    for (const principle of team.principles) expect(Principle.decode(principle)._tag).toBe('Ok')
    for (const room of team.conversations) expect(ConversationId.decode(room.id)._tag).toBe('Ok')
    for (const group of team.groups) expect(GroupId.decode(group.id)._tag).toBe('Ok')
    for (const { credential } of team.credentials) expect(CredentialId.decode(credential.id)._tag).toBe('Ok')
    expect(MemberId.decode(VISITOR_ID)._tag).toBe('Ok')
  })

  it('places every note in a conversation its author takes part in, before now', () => {
    for (const note of team.notes) {
      const room = team.conversations.find((each) => each.id === note.conversationId)
      expect(room?.participantIds).toContain(note.authorId)
      expect(note.createdAt).toBeLessThan(NOW)
    }
  })

  it('leaves two drafts waiting: the visitor’s agent’s reply, and a channel’s agent’s answer to review', () => {
    const drafts = team.notes.filter((note) => note.status === 'draft')
    expect(drafts.map((note) => note.authorId === VISITOR_ID)).toEqual([true, false])
    const agent = team.members.find((each) => each.member.id === drafts[1]!.authorId)!.member
    expect(isPerson(agent)).toBe(false)
    expect(team.channels.find((channel) => channel.agentId === agent.id)?.slug).toBe('billing')
  })

  it('signs the visitor in with a session of their own, beside the agent they connected', () => {
    const own = team.credentials.filter((each) => each.memberId === VISITOR_ID)
    expect(own.map((each) => each.credential.kind)).toEqual(['human', 'agent'])
    expect(own[0]!.credential.id).toBe(VISITOR_SESSION)
  })

  it('makes the visitor an administrator, and keeps the long names, text and links and the empty room that test a layout', () => {
    const visitor = team.members.find((each) => each.member.id === VISITOR_ID)!.member
    expect(visitor.role).toBe('admin')
    expect(Math.max(...team.members.map((each) => each.member.name.length))).toBeGreaterThan(40)
    expect(team.notes.some((note) => /https:\/\/\S{150,}/.test(note.body))).toBe(true)
    expect(Math.max(...team.channels.map((channel) => channel.description.length))).toBeGreaterThan(150)
    const empty = team.channels.filter(
      (channel) => !team.notes.some((note) => note.conversationId === channel.conversationId),
    )
    expect(empty.map((channel) => channel.slug)).toContain('design-reviews-for-the-customer-portal')
    for (const debate of team.debates) expect(Debate.decode(debate)._tag).toBe('Ok')
  })
})
