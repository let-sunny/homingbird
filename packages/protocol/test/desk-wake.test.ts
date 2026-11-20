import { describe, expect, it } from 'vitest'
import {
  DESK_WAKE_HEADERS_MAX,
  DeskWake,
  DeskWakeHeader,
  DeskWakeSetup,
  DeskWakeTest,
  isReservedWakeHeader,
} from '../src/desk-wake.ts'

const SETUP = {
  url: 'https://api.anthropic.com/v1/claude_code/routines/trig_1/fire',
  headers: [{ name: 'Authorization', value: 'Bearer secret' }],
  credentialId: 'cred_agent0000000',
  enabled: true,
}

const WAKE = {
  host: 'api.anthropic.com',
  headerNames: ['Authorization'],
  credentialId: 'cred_agent0000000',
  enabled: true,
  lastWakeAt: null,
  lastStatus: 'never',
  failures: 0,
  stoppedBecause: null,
  createdAt: 1,
  updatedAt: 1,
}

describe('a cloud desk’s wake', () => {
  it('accepts an https address with up to four headers', () => {
    expect(DeskWakeSetup.decode(SETUP)._tag).toBe('Ok')
    const most = Array.from({ length: DESK_WAKE_HEADERS_MAX }, (_, index) => ({
      name: `X-${index}`,
      value: 'v',
    }))
    expect(DESK_WAKE_HEADERS_MAX).toBe(4)
    expect(DeskWakeSetup.decode({ ...SETUP, headers: most })._tag).toBe('Ok')
    expect(DeskWakeSetup.decode({ ...SETUP, headers: [...most, { name: 'X-4', value: 'v' }] })._tag).toBe(
      'Err',
    )
  })

  it('refuses a plain http address, or one with spaces', () => {
    expect(DeskWakeSetup.decode({ ...SETUP, url: 'http://api.anthropic.com/fire' })._tag).toBe('Err')
    expect(DeskWakeSetup.decode({ ...SETUP, url: 'https://api.anthropic.com/a b' })._tag).toBe('Err')
  })

  it('refuses a header whose name is not a token or whose value could split the request', () => {
    expect(DeskWakeHeader.decode({ name: 'X Key', value: 'v' })._tag).toBe('Err')
    expect(DeskWakeHeader.decode({ name: 'X-Key', value: 'a\r\nHost: evil' })._tag).toBe('Err')
    expect(DeskWakeHeader.decode({ name: 'X-Key', value: ' padded ' })._tag).toBe('Err')
    expect(DeskWakeHeader.decode({ name: 'X-Key', value: '' })._tag).toBe('Err')
    expect(DeskWakeHeader.decode({ name: 'X-Key', value: 'a' })._tag).toBe('Ok')
    expect(DeskWakeHeader.decode({ name: 'X-Key', value: 'Bearer a.b-c' })._tag).toBe('Ok')
  })

  it('reserves the headers the server sets and the ones proxies read, in any case', () => {
    for (const name of [
      'Host',
      'cookie',
      'Connection',
      'Keep-Alive',
      'Upgrade',
      'TE',
      'Trailer',
      'Transfer-Encoding',
      'Forwarded',
      'Content-Type',
      'content-length',
      'Proxy-Authorization',
      'X-Forwarded-For',
    ])
      expect([name, isReservedWakeHeader(name)]).toEqual([name, true])
    for (const name of ['Authorization', 'anthropic-version', 'X-Api-Key', 'Hostname', 'X-Forwarded'])
      expect([name, isReservedWakeHeader(name)]).toEqual([name, false])
  })

  it('reads a status or a stop a newer server adds as unknown', () => {
    expect(DeskWake.decode(WAKE)._tag).toBe('Ok')
    expect(DeskWake.read({ ...WAKE, lastStatus: 'woken_twice', stoppedBecause: 'paused' })).toEqual({
      _tag: 'Ok',
      value: { ...WAKE, lastStatus: 'unknown', stoppedBecause: 'unknown' },
    })
    expect(DeskWakeTest.read({ status: 200, outcome: 'later' })).toEqual({
      _tag: 'Ok',
      value: { status: 200, outcome: 'unknown' },
    })
  })
})
