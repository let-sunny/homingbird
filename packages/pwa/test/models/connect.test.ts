import type { ConsentRequest, DeviceRequest } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { connectionName, consentModel, deviceModel } from '../../src/models/connect.ts'
import { strings } from '../../src/strings.ts'

const device = { userCode: 'ABCD-EFGH', client: 'Claude Code' } as DeviceRequest
const consent = { id: 'consent_1', client: 'Desk', redirectHost: 'desk.example.com' } as ConsentRequest

describe('deviceModel', () => {
  it('asks for the code, waits for it, then shows what the device asks for', () => {
    expect(deviceModel({ step: 'ask' })).toEqual({ kind: 'code' })
    expect(deviceModel({ step: 'loading' })).toEqual({ kind: 'loading' })
    expect(deviceModel({ step: 'decide', request: device })).toEqual({
      kind: 'decide',
      lines: [
        { text: strings.deviceAsks({ client: 'Claude Code' }), style: 'ask' },
        { text: 'ABCD-EFGH', style: 'code-shown' },
        { text: strings.deviceAgentGrant, style: null },
      ],
      nameLabel: strings.deviceNameLabel,
      name: 'Claude Code',
    })
  })

  it('says how it was decided', () => {
    expect(deviceModel({ step: 'done', approved: true })).toEqual({
      kind: 'outcome',
      approved: true,
      pip: 'approved',
      title: strings.connectedTitle,
      message: strings.deviceApproved,
    })
    expect(deviceModel({ step: 'done', approved: false })).toMatchObject({
      pip: 'discarded',
      title: strings.deniedTitle,
      message: strings.deviceDenied,
    })
  })
})

describe('consentModel', () => {
  it('waits for the request, then asks, then says where the person returns', () => {
    expect(consentModel(null, null)).toEqual({ kind: 'loading' })
    expect(consentModel(consent, null)).toMatchObject({
      kind: 'decide',
      name: 'Desk',
      nameLabel: strings.consentNameLabel,
    })
    expect(consentModel(consent, { approved: true })).toMatchObject({
      message: strings.consentApproved({ host: 'desk.example.com' }),
    })
    expect(consentModel(consent, { approved: false })).toMatchObject({
      message: strings.consentDenied({ host: 'desk.example.com' }),
    })
  })
})

describe('connectionName', () => {
  it('takes what the person typed, else what the agent called itself', () => {
    expect(connectionName('  Laptop ', 'Desk')).toBe('Laptop')
    expect(connectionName('  ', 'Desk')).toBe('Desk')
  })
})
