import { describe, expect, it } from 'vitest'
import { conversationToRestore, homeModel, startingPointsModel } from '../../src/models/home.ts'
import { strings } from '../../src/strings.ts'
import { ROOM, conversation, note } from '../support/fixtures.ts'

describe('homeModel', () => {
  it('waits for the list, offers starting points without conversations, and asks to pick one otherwise', () => {
    expect(homeModel({ loaded: false, conversations: [] })).toEqual({ kind: 'loading' })
    expect(homeModel({ loaded: true, conversations: [] })).toEqual({
      kind: 'start',
      start: startingPointsModel(),
    })
    expect(homeModel({ loaded: true, conversations: [conversation()] })).toEqual({
      kind: 'pick',
      text: strings.pickConversation,
    })
  })
})

describe('startingPointsModel', () => {
  it('offers a channel, a person and connecting an agent, then the tour', () => {
    const model = startingPointsModel()
    expect(model.points.map((point) => point.href)).toEqual(['#/channels', '#/people', '#/agent/connection'])
    expect(model.title).toBe(strings.start.title)
    expect(model.tour).toBe(strings.start.tour)
  })
})

describe('conversationToRestore', () => {
  const recent = conversation({ lastNote: note('n1'), lastActivityAt: 5 })
  const input = { loaded: true, conversations: [recent], besideTheList: true, hash: '#/' }

  it('opens the most recent conversation while home sits beside the list', () => {
    expect(conversationToRestore(input)).toBe(ROOM)
  })

  it('opens nothing before the list loads, on a narrow screen, once the person went elsewhere, or with none', () => {
    expect(conversationToRestore({ ...input, loaded: false })).toBeNull()
    expect(conversationToRestore({ ...input, besideTheList: false })).toBeNull()
    expect(conversationToRestore({ ...input, hash: '#/people' })).toBeNull()
    expect(conversationToRestore({ ...input, conversations: [] })).toBeNull()
  })
})
