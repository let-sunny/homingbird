import { describe, expect, it } from 'vitest'
import { makeTestLog } from '../src/log/operational-log.ts'
import { logUnexpectedStop } from '../src/log/unexpected-stop.ts'

describe('an unexpected stop', () => {
  it('logs a defect by its name and its redacted detail, never the token it carried', () => {
    const { log, events } = makeTestLog()
    logUnexpectedStop(log, 'debug', {
      _tag: 'Die',
      defect: new TypeError('Bearer hba_0123456789abcdefghij leaked'),
    })
    expect(events().map((line) => [line.eventName, line.attributes.defect])).toEqual([
      ['system.stopped', 'TypeError'],
      ['defect.detail', 'TypeError'],
    ])
    expect(JSON.stringify(events())).not.toContain('hba_0123456789abcdefghij')
  })

  it('logs an expected failure by its tag, without its fields', () => {
    const { log, events } = makeTestLog('error')
    logUnexpectedStop(log, 'debug', {
      _tag: 'Fail',
      error: { _tag: 'Unavailable', message: 'ana@example.com' },
    })
    expect(events()).toEqual([
      expect.objectContaining({ eventName: 'system.stopped', attributes: { defect: 'Unavailable' } }),
    ])
    expect(JSON.stringify(events())).not.toContain('ana@example.com')
  })

  it('names an interruption, and a failure whose tag is not a name by its type', () => {
    const { log, events } = makeTestLog('error')
    logUnexpectedStop(log, 'debug', { _tag: 'Interrupt' })
    logUnexpectedStop(log, 'debug', { _tag: 'Fail', error: { _tag: 'not a name!' } })
    logUnexpectedStop(log, 'debug', { _tag: 'Fail', error: null })
    expect(events().map((line) => line.attributes.defect)).toEqual(['Interrupt', 'object', 'object'])
  })

  it('tells stderr the event and the tag when the operational log is off, and nothing else', () => {
    const { log, events } = makeTestLog('off')
    const line = logUnexpectedStop(log, 'off', {
      _tag: 'Die',
      defect: new RangeError('Bearer hba_0123456789abcdefghij'),
    })
    expect([line, events()]).toEqual(['Dovecote stopped unexpectedly: system.stopped RangeError.', []])
    expect(logUnexpectedStop(log, 'error', { _tag: 'Interrupt' })).toBe(
      'Dovecote stopped unexpectedly; the operational log says why.',
    )
  })
})
