import type { MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { type NewMessageInput, newMessageModel, recipientsOf } from '../../src/models/new-message.ts'
import type { PickerCandidate } from '../../src/models/people-picker.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, ROOM, conversation } from '../support/fixtures.ts'

const DEE = 'mem_dee000000000' as MemberId

const candidate = (memberId: MemberId, name: string, reason: string | null = null): PickerCandidate => ({
  memberId,
  name,
  email: `${name.toLowerCase()}@example.com`,
  presence: { humanOnline: false, agentOnline: false },
  reason,
})

const input = (fields: Partial<NewMessageInput> = {}): NewMessageInput => ({
  candidates: [candidate(BEN, 'Ben'), candidate(CY, 'Cy'), candidate(DEE, 'Dee', 'You blocked Dee.')],
  chosen: [],
  conversations: [],
  viewerId: ANA,
  typed: '',
  sending: false,
  draftRequestsOn: true,
  myPresence: { humanOnline: true, agentOnline: true },
  ...fields,
})

describe('newMessageModel', () => {
  it('asks whom the note is for before it may be sent or drafted', () => {
    const model = newMessageModel(input({ typed: 'Hello' }))
    expect(model.title).toBe(strings.newMessage.title)
    expect(model.to).toBe(strings.newMessage.to)
    expect(model.audience).toBe(strings.newMessage.nobody)
    expect(model.where).toBeNull()
    expect(model.send).toEqual({
      label: strings.send,
      enabled: false,
      reason: strings.newMessage.chooseFirst,
    })
    expect(model.ask).toEqual({ enabled: false, reason: strings.newMessage.chooseFirst })
  })

  it('names the one reader, and says the note starts their direct message', () => {
    const model = newMessageModel(input({ chosen: [BEN, DEE], typed: '  Hi  ' }))
    expect(model.audience).toBe(strings.newMessage.onlyOne({ name: 'Ben' }))
    expect(model.where).toEqual({ text: strings.newMessage.newDirect, link: null })
    expect(model.send).toEqual({ label: strings.send, enabled: true, reason: null })
    expect(model.ask).toEqual({ enabled: true, reason: null })
    expect(newMessageModel(input({ chosen: [BEN], typed: '   ' })).send.enabled).toBe(false)
  })

  it('names every reader of a group, and says they see it once a note is sent', () => {
    const model = newMessageModel(input({ chosen: [CY, BEN] }))
    expect(model.audience).toBe(strings.newMessage.several({ names: 'Cy and Ben' }))
    expect(model.where).toEqual({ text: strings.newMessage.newGroup, link: null })
  })

  it('sends to the room there already is, and offers to open it', () => {
    const direct = newMessageModel(input({ chosen: [BEN], conversations: [conversation()] }))
    expect(direct.where).toEqual({
      text: strings.newMessage.existingDirect,
      link: { label: strings.newMessage.openExisting, href: `#/c/${ROOM}` },
    })
    const group = newMessageModel(
      input({
        chosen: [BEN, CY],
        conversations: [conversation({ kind: 'group', participantIds: [ANA, BEN, CY] })],
      }),
    )
    expect(group.where?.text).toBe(strings.newMessage.existingGroup)
  })

  it('holds both while sending, and says why the agent cannot be asked', () => {
    const sending = newMessageModel(input({ chosen: [BEN], typed: 'Hi', sending: true }))
    expect(sending.send).toEqual({ label: strings.sending, enabled: false, reason: null })
    expect(sending.ask?.enabled).toBe(false)
    const unavailable = newMessageModel(
      input({
        chosen: [BEN],
        myPresence: { humanOnline: true, agentOnline: true, agentUnavailable: { until: null } },
      }),
    )
    expect(unavailable.ask).toEqual({ enabled: false, reason: strings.deskUnavailableReason.unknown })
    expect(newMessageModel(input({ draftRequestsOn: false })).ask).toBeNull()
  })
})

describe('recipientsOf', () => {
  it('keeps only the people chosen who may be written to', () => {
    expect(recipientsOf(input({ chosen: [DEE, CY, ANA, CY] }))).toEqual([CY])
  })
})
