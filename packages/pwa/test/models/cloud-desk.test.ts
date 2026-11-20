import type { AsRead } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { cloudDeskModel, deskWakeSetupFrom } from '../../src/models/cloud-desk.ts'
import { dateTimeText } from '../../src/models/time.ts'
import { strings } from '../../src/strings.ts'
import { credential } from '../support/fixtures.ts'

const wakeOf = (fields: Partial<AsRead.DeskWake> = {}): AsRead.DeskWake => ({
  host: 'api.anthropic.com',
  headerNames: ['Authorization', 'anthropic-version'],
  credentialId: 'cred_cloud0000000' as never,
  enabled: true,
  lastWakeAt: null,
  lastStatus: 'never',
  failures: 0,
  stoppedBecause: null,
  createdAt: 1,
  updatedAt: 1,
  ...fields,
})

const CREDENTIALS = [
  credential('cred_cloud0000000', { name: 'Cloud desk' }),
  credential('cred_laptop000000', { name: 'Laptop' }),
  credential('cred_old000000000', { name: 'Old', revokedAt: 5 }),
  credential('cred_web000000000', { name: 'Browser', kind: 'human' }),
]

const modelOf = (fields: Partial<Parameters<typeof cloudDeskModel>[0]> = {}) =>
  cloudDeskModel({ wake: null, credentials: CREDENTIALS, preset: 'routine', tested: null, ...fields })

describe('cloudDeskModel', () => {
  it('waits for the wake and the connections before showing anything', () => {
    expect(modelOf({ wake: undefined }).loading).toBe(true)
    expect(modelOf({ credentials: null }).loading).toBe(true)
    expect(modelOf({ credentials: null }).noAgent).toBe(strings.cloudDesk.noAgent)
    expect(modelOf().loading).toBe(false)
  })

  it('offers the Claude routine first, filling its address format and headers', () => {
    const model = modelOf()
    expect(model.presets.map((each) => [each.value, each.label, each.checked])).toEqual([
      ['routine', strings.cloudDesk.routine, true],
      ['generic', strings.cloudDesk.generic, false],
    ])
    expect(model.presetNote).toBe(strings.cloudDesk.routineNote)
    expect(model.urlPlaceholder).toBe('https://api.anthropic.com/v1/claude_code/routines/trig_…/fire')
    expect(model.headers).toEqual([
      { name: 'Authorization', value: '', placeholder: 'Bearer sk-ant-oat01-…' },
      { name: 'anthropic-version', value: '2023-06-01', placeholder: '' },
      { name: '', value: '', placeholder: '' },
      { name: '', value: '', placeholder: '' },
    ])
  })

  it('fills the generic preset with one header and warns about broad tokens', () => {
    const model = modelOf({ preset: 'generic' })
    expect(model.presets.find((each) => each.checked)?.value).toBe('generic')
    expect(model.presetNote).toBe(strings.cloudDesk.genericNote)
    expect(model.headers.map((header) => header.name)).toEqual(['Authorization', '', '', ''])
  })

  it('lists only the person’s live agent connections, the bound one chosen', () => {
    expect(modelOf({ wake: wakeOf() }).agents).toEqual([
      { value: 'cred_cloud0000000', label: 'Cloud desk', selected: true },
      { value: 'cred_laptop000000', label: 'Laptop', selected: false },
    ])
    expect(modelOf({ credentials: [CREDENTIALS[3]!] }).noAgent).toBe(strings.cloudDesk.noAgent)
    expect(modelOf().noAgent).toBeNull()
  })

  it('shows nothing about a wake before one is saved, and asks for the token again once one is', () => {
    expect(modelOf()).toMatchObject({
      status: null,
      facts: [],
      isSaved: false,
      replaceHint: null,
      enabled: true,
    })
    expect(modelOf({ wake: wakeOf({ enabled: false }) })).toMatchObject({
      isSaved: true,
      replaceHint: strings.cloudDesk.replaceHint,
      enabled: false,
    })
  })

  it('says how the last wake went, and when', () => {
    const at = Date.UTC(2026, 10, 20, 9)
    const cases: ReadonlyArray<[AsRead.DeskWake['lastStatus'], string, string]> = [
      ['never', strings.cloudDesk.status.never, 'is-ok'],
      ['sent', strings.cloudDesk.status.sent, 'is-ok'],
      ['online', strings.cloudDesk.status.online, 'is-ok'],
      ['not_online', strings.cloudDesk.status.notOnline, 'is-waiting'],
      ['refused', strings.cloudDesk.status.refused, 'is-waiting'],
      ['rate_limited', strings.cloudDesk.status.rateLimited, 'is-waiting'],
      ['unreachable', strings.cloudDesk.status.unreachable, 'is-waiting'],
      ['unknown', strings.cloudDesk.status.unknown, 'is-waiting'],
    ]
    for (const [lastStatus, text, tone] of cases)
      expect(modelOf({ wake: wakeOf({ lastStatus, lastWakeAt: at }) }).status).toEqual({ text, tone })
    expect(modelOf({ wake: wakeOf({ lastWakeAt: at }) }).facts).toEqual([
      { term: strings.cloudDesk.lastWake, value: dateTimeText(at, '') },
    ])
    expect(modelOf({ wake: wakeOf() }).facts).toEqual([
      { term: strings.cloudDesk.lastWake, value: strings.cloudDesk.never },
    ])
  })

  it('counts failed wakes in a row while it still tries', () => {
    expect(modelOf({ wake: wakeOf({ failures: 2, lastStatus: 'unreachable' }) }).facts[1]).toEqual({
      term: strings.cloudDesk.service,
      value: strings.cloudDesk.failures({ count: 2 }),
    })
    expect(modelOf({ wake: wakeOf({ failures: 5, stoppedBecause: 'failures' }) }).facts).toHaveLength(1)
  })

  it('says why it stopped and what to do, and when it is paused', () => {
    const stops: ReadonlyArray<[NonNullable<AsRead.DeskWake['stoppedBecause']>, string]> = [
      ['refused', strings.cloudDesk.stopped.refused],
      ['failures', strings.cloudDesk.stopped.failures],
      ['credential_gone', strings.cloudDesk.stopped.credentialGone],
      ['unreadable', strings.cloudDesk.stopped.unreadable],
      ['unknown', strings.cloudDesk.stopped.unknown],
    ]
    for (const [stoppedBecause, text] of stops)
      expect(modelOf({ wake: wakeOf({ stoppedBecause, enabled: false }) }).status).toEqual({
        text,
        tone: 'is-stopped',
      })
    expect(modelOf({ wake: wakeOf({ enabled: false }) }).status).toEqual({
      text: strings.cloudDesk.status.paused,
      tone: 'is-waiting',
    })
  })

  it('says what a test wake came to', () => {
    const testedAs = (status: number, outcome: AsRead.DeskWakeTest['outcome']) =>
      modelOf({ wake: wakeOf(), tested: { status, outcome } }).tested
    expect(testedAs(200, 'sent')).toBe(strings.cloudDesk.tested.sent({ status: '200' }))
    expect(testedAs(0, 'sent')).toBe(strings.cloudDesk.tested.timedOut)
    expect(testedAs(401, 'refused')).toBe(strings.cloudDesk.tested.refused({ status: '401' }))
    expect(testedAs(429, 'rate_limited')).toBe(strings.cloudDesk.tested.rateLimited({ status: '429' }))
    expect(testedAs(503, 'unreachable')).toBe(strings.cloudDesk.tested.unreachable({ status: '503' }))
    expect(testedAs(200, 'unknown')).toBe(strings.cloudDesk.tested.unknown)
    expect(modelOf().tested).toBeNull()
  })
})

describe('deskWakeSetupFrom', () => {
  it('trims what was typed and leaves out empty header rows', () => {
    expect(
      deskWakeSetupFrom({
        url: ' https://api.anthropic.com/v1/claude_code/routines/trig_1/fire ',
        headers: [
          { name: ' Authorization ', value: ' Bearer token ' },
          { name: 'anthropic-version', value: '2023-06-01' },
          { name: '', value: '' },
          { name: ' ', value: '' },
        ],
        credentialId: 'cred_cloud0000000',
        enabled: true,
      }),
    ).toEqual({
      url: 'https://api.anthropic.com/v1/claude_code/routines/trig_1/fire',
      headers: [
        { name: 'Authorization', value: 'Bearer token' },
        { name: 'anthropic-version', value: '2023-06-01' },
      ],
      credentialId: 'cred_cloud0000000',
      enabled: true,
    })
  })

  it('keeps a row with only a value, so the server says what is missing', () => {
    expect(
      deskWakeSetupFrom({
        url: 'https://x',
        headers: [{ name: '', value: 'v' }],
        credentialId: '',
        enabled: false,
      }).headers,
    ).toEqual([{ name: '', value: 'v' }])
  })
})
