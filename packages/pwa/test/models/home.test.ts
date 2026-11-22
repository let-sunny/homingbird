import { describe, expect, it } from 'vitest'
import { conversationToRestore, homeModel, startingPointsModel } from '../../src/models/home.ts'
import { strings } from '../../src/strings.ts'
import { ROOM, conversation, note } from '../support/fixtures.ts'

const start = { agentConnected: false, origin: 'https://hb.example.com' }

describe('homeModel', () => {
  it('waits for the list, offers starting points without conversations, and asks to pick one otherwise', () => {
    expect(homeModel({ loaded: false, conversations: [], ...start })).toEqual({ kind: 'loading' })
    expect(homeModel({ loaded: true, conversations: [], ...start })).toEqual({
      kind: 'start',
      start: startingPointsModel(start),
    })
    expect(homeModel({ loaded: true, conversations: [conversation()], ...start })).toEqual({
      kind: 'pick',
      text: strings.pickConversation,
    })
  })
})

describe('startingPointsModel', () => {
  it('leads with connecting the agent, with the two lines to paste for this server, then writing and approving', () => {
    const model = startingPointsModel(start)
    expect(model.title).toBe(strings.start.firstTitle)
    expect(model.steps.map((step) => step.title)).toEqual([
      strings.start.connectStep,
      strings.start.writeStep,
      strings.start.approveStep,
    ])
    const [connect, write, approve] = model.steps
    expect(connect!.command).toBe(
      '/plugin install homingbird --marketplace let-sunny/homingbird\n/homingbird https://hb.example.com',
    )
    expect(connect!.done).toBeNull()
    expect(connect!.links).toEqual([
      { href: '#/agent/connection', label: strings.start.otherAgents, primary: false },
    ])
    expect(write!.links.map((link) => [link.href, link.primary])).toEqual([
      ['#/people', false],
      ['#/channels', false],
    ])
    expect(approve).toEqual({
      title: strings.start.approveStep,
      hint: strings.start.approveStepHint,
      command: null,
      done: null,
      links: [],
    })
    expect(model.tour).toBe(strings.start.tour)
  })

  it('marks the agent connected and makes writing to a colleague the next step', () => {
    const [connected, write] = startingPointsModel({ ...start, agentConnected: true }).steps
    expect(connected).toEqual({
      title: strings.start.connectedStep,
      hint: strings.start.connectedStepHint,
      command: null,
      done: strings.start.done,
      links: [],
    })
    expect(write!.links.map((link) => link.primary)).toEqual([true, false])
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
