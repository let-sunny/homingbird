import { Task as T } from '@homingbird/kernel'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import {
  defectNameOf,
  logDefect,
  logEvent,
  makeLog,
  makeTestLog,
  redact,
  writeToStandardOutput,
} from '../src/log/operational-log.ts'

describe('the operational log', () => {
  it('writes one JSON object per line with OpenTelemetry field names', () => {
    const lines: string[] = []
    const log = makeLog({
      level: 'info',
      write: (line) => lines.push(line),
      now: () => 1_700_000_000_000,
      version: '0.1.4',
    })
    log.emit({ name: 'system.started', attributes: { version: '0.1.4', port: 8080 } }, 'req_1')
    expect(JSON.parse(lines[0]!)).toEqual({
      timestamp: '2023-11-14T22:13:20.000Z',
      severityText: 'INFO',
      severityNumber: 9,
      eventName: 'system.started',
      body: 'Dovecote is starting.',
      attributes: { version: '0.1.4', port: 8080, requestId: 'req_1' },
      resource: { 'service.name': 'dovecote', 'service.version': '0.1.4' },
    })
  })

  it('writes only lines at or above its level, and nothing when off', () => {
    const quiet = makeTestLog('warn')
    quiet.log.emit({ name: 'system.audit_off', attributes: {} })
    quiet.log.emit({ name: 'system.started', attributes: { version: 'x', port: 1 } })
    expect(quiet.events().map((line) => line.eventName)).toEqual(['system.audit_off'])
    const silent = makeTestLog('off')
    silent.log.emit({ name: 'background.stopped', attributes: { defect: 'Error' } })
    expect(silent.lines).toEqual([])
  })

  it('keeps only the attributes an event declares, and marks attributes that do not fit', () => {
    const test = makeTestLog()
    test.log.emit({
      name: 'system.started',
      attributes: { version: 'x', port: 1, token: 'hbh_secret' } as never,
    })
    test.log.emit({ name: 'system.started', attributes: { version: 'x', port: -1 } })
    expect(test.events().map((line) => line.attributes)).toEqual([
      { version: 'x', port: 1 },
      { invalidAttributes: true },
    ])
  })

  it('adds the request id of the request it runs in', async () => {
    const test = makeTestLog()
    await T.runPromise(logEvent({ name: 'sign_in.provider_failed', attributes: {} }), {
      log: test.log,
      requestId: 'req_7',
    })
    await T.runPromise(logEvent({ name: 'sign_in.provider_failed', attributes: {} }), {
      log: test.log,
      requestId: null,
    })
    expect(test.events().map((line) => line.attributes)).toEqual([{ requestId: 'req_7' }, {}])
  })

  it('logs a defect by name, and its detail only at debug, redacted', () => {
    const debug = makeTestLog('debug')
    const defect = new TypeError('failed for ana@example.com with Bearer hbh_abcdefghijklmnopqrstuvwx')
    logDefect(
      debug.log,
      { name: 'background.stopped', attributes: { defect: defectNameOf(defect) } },
      defect,
      'req_2',
    )
    const [stopped, detail] = debug.events()
    expect(stopped).toMatchObject({
      eventName: 'background.stopped',
      attributes: { defect: 'TypeError', requestId: 'req_2' },
    })
    expect(detail?.attributes.detail).toContain('failed for [email] with Bearer [redacted]')
    const info = makeTestLog('info')
    logDefect(info.log, { name: 'background.stopped', attributes: { defect: 'TypeError' } }, defect)
    expect(info.lines.join('\n')).not.toContain('ana@example.com')
    expect(info.events()).toHaveLength(1)
  })

  it('names a defect by its type, never by its message', () => {
    expect(defectNameOf(new RangeError('x'))).toBe('RangeError')
    expect(defectNameOf('text')).toBe('string')
    const odd = new Error('x')
    odd.name = 'name with spaces and a token hbh_x'
    expect(defectNameOf(odd)).toBe('Unknown')
  })

  it('redacts tokens, authorization, cookies, query strings, email addresses and long secrets', () => {
    expect(
      redact(
        'GET /auth/callback?code=abc&state=def cookie: hb_session=hbh_aaaaaaaaaaaaaaaa\nauthorization: x secret 0123456789abcdef0123456789abcdef',
      ),
    ).toBe('GET /auth/callback?[query] cookie: [redacted]\nauthorization: [redacted]')
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9_-]{24,40}$/), (secret) => {
        expect(redact(`token hb${'h'}_${secret} done`)).not.toContain(secret)
      }),
    )
    expect(redact('ab '.repeat(2000))).toHaveLength(4000)
  })

  it('writes each line to stdout, ended by a newline', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    try {
      writeToStandardOutput('{"eventName":"system.started"}')
      expect(out).toHaveBeenCalledWith('{"eventName":"system.started"}\n')
    } finally {
      out.mockRestore()
    }
  })
})
