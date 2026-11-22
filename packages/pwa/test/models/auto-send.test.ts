import type { ConversationId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  autoSendDetails,
  autoSendFormModel,
  autoSendPlaces,
  autoSendToSave,
  canSendItself,
} from '../../src/models/auto-send.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, ROOM, channel, conversation, member, principle } from '../support/fixtures.ts'

const answer = (fields: Parameters<typeof principle>[1] = {}) =>
  principle('Office hours', {
    kind: 'answer',
    rule: 'Nine to five.',
    autoSend: { enabled: false, places: [] },
    ...fields,
  })

const members = new Map([
  [ANA, member(ANA, 'Ana')],
  [BEN, member(BEN, 'Ben')],
  [CY, member(CY, 'Cy')],
])

describe('canSendItself', () => {
  it('lets only a saved answer with its own text send itself, and only while the organization allows it', () => {
    expect(canSendItself(answer())).toBe(true)
    expect(canSendItself(answer({ kind: 'rule' }))).toBe(false)
    expect(canSendItself(answer({ rule: '  ', source: 'https://wiki.example/hours' }))).toBe(false)
    const { autoSend: _, ...offered } = answer()
    expect(canSendItself(offered)).toBe(false)
  })
})

describe('autoSendFormModel', () => {
  it('shows the switch as it is, with each place chosen or not', () => {
    const model = autoSendFormModel(answer({ autoSend: { enabled: true, places: [ROOM] } }), [
      { id: ROOM, label: 'Ben' },
      { id: 'conv_lobby0000000' as ConversationId, label: '#lobby' },
    ])
    expect(model).toMatchObject({
      title: strings.autoSend.dialogTitle({ name: 'Office hours' }),
      enabled: true,
      places: [
        { id: ROOM, label: 'Ben', chosen: true },
        { id: 'conv_lobby0000000', label: '#lobby', chosen: false },
      ],
      noPlaces: null,
    })
  })

  it('says where to go first when there is nowhere it may send itself, and offers nothing for a rule', () => {
    expect(autoSendFormModel(answer(), [])?.noPlaces).toBe(strings.autoSend.noPlaces)
    expect(autoSendFormModel(answer({ kind: 'rule' }), [])).toBeNull()
  })
})

describe('autoSendPlaces', () => {
  it('offers direct messages and the open channels the person is in, alphabetically, and nothing else', () => {
    const lobby = channel('lobby', { joined: true })
    const payroll = channel('payroll', { joined: true, visibility: 'private' })
    const ops = channel('ops', { joined: false })
    const places = autoSendPlaces({
      conversations: [
        conversation({ id: ROOM, participantIds: [ANA, BEN] }),
        conversation({ id: 'conv_cy0000000000' as ConversationId, participantIds: [ANA, CY], archivedAt: 5 }),
        conversation({ id: lobby.conversationId, kind: 'channel', title: 'lobby' }),
        conversation({ id: payroll.conversationId, kind: 'channel', title: 'payroll' }),
        conversation({ id: ops.conversationId, kind: 'channel', title: 'ops' }),
        conversation({
          id: 'conv_group0000000' as ConversationId,
          kind: 'group',
          participantIds: [ANA, BEN, CY],
        }),
        conversation({
          id: 'conv_ask000000000' as ConversationId,
          kind: 'group',
          privateQuestionOf: 'lobby',
        }),
      ],
      channels: [lobby, payroll, ops],
      members,
      viewerId: ANA,
    })
    expect(places).toEqual([
      { id: lobby.conversationId, label: '#lobby' },
      { id: ROOM, label: 'Ben' },
    ])
  })
})

describe('autoSendToSave', () => {
  it('refuses a switch turned on with nowhere to send, and sends each place once otherwise', () => {
    expect(autoSendToSave(true, [])).toEqual({ problem: strings.autoSend.needsPlace })
    expect(autoSendToSave(false, [])).toEqual({ save: { enabled: false, places: [] } })
    expect(autoSendToSave(true, [ROOM, ROOM])).toEqual({ save: { enabled: true, places: [ROOM] } })
  })
})

describe('autoSendDetails', () => {
  it('says in how many places an answer sends itself and how often it did, and nothing while it is off', () => {
    const on = answer({
      autoSend: { enabled: true, places: [ROOM] },
      counts: { applied: 3, sentAsWritten: 0, edited: 0, discarded: 0, missed: 0, autoSent: 3 },
    })
    expect(autoSendDetails(on)).toEqual([
      strings.autoSend.sendsIn({ count: 1 }),
      strings.autoSend.sentCount({ count: 3 }),
    ])
    expect(autoSendDetails(answer())).toEqual([])
    const { autoSend: _, ...offered } = on
    expect(autoSendDetails(offered)).toEqual([])
  })
})
