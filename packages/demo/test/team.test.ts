import {
  ConversationId,
  CredentialId,
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
})
