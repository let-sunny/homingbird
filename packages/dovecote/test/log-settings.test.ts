import { describe, expect, it } from 'vitest'
import { DEFAULT_LOG_SETTINGS, isWrittenAt, logSettingsFrom } from '../src/log/log-settings.ts'

describe('HB_LOGS', () => {
  it('defaults to a full audit trail, information lines, no request lines and no audit copy', () => {
    expect(logSettingsFrom('', false)).toEqual({ settings: DEFAULT_LOG_SETTINGS, problems: [] })
    expect(DEFAULT_LOG_SETTINGS).toEqual({
      audit: 'full',
      operational: 'info',
      requests: false,
      auditCopy: false,
    })
  })

  it.each([
    ['audit=off', { audit: 'off' }],
    ['audit=security', { audit: 'security' }],
    ['audit=full', { audit: 'full' }],
    ['operational=off', { operational: 'off' }],
    ['operational=error', { operational: 'error' }],
    ['operational=warn', { operational: 'warn' }],
    ['operational=debug', { operational: 'debug' }],
    ['requests=on', { requests: true }],
    ['requests=off', { requests: false }],
    ['auditCopy=on', { auditCopy: true }],
    ['auditCopy=off', { auditCopy: false }],
  ])('reads %s', (text, expected) => {
    expect(logSettingsFrom(text, false)).toEqual({
      settings: { ...DEFAULT_LOG_SETTINGS, ...expected },
      problems: [],
    })
  })

  it('names every item it cannot read, and a kind set twice', () => {
    expect(logSettingsFrom('audit=all, verbose, requests=on, requests=off', false).problems).toEqual([
      expect.stringMatching(/^HB_LOGS: "audit=all" is not a log setting; write audit=full\|security\|off/),
      expect.stringMatching(/^HB_LOGS: "verbose" is not a log setting/),
      'HB_LOGS: "requests" is set twice',
    ])
  })

  it('reads HB_AUDIT_STDOUT=1 as auditCopy=on, and refuses when the two disagree', () => {
    expect(logSettingsFrom('', true).settings.auditCopy).toBe(true)
    expect(logSettingsFrom('auditCopy=on', true).problems).toEqual([])
    expect(logSettingsFrom('auditCopy=off', true).problems).toEqual([
      'HB_AUDIT_STDOUT=1 and HB_LOGS auditCopy=off disagree; keep only HB_LOGS',
    ])
  })

  it('refuses any choice that would drop output it asks for', () => {
    for (const level of ['off', 'error', 'warn'])
      for (const kind of ['auditCopy', 'requests'])
        expect(logSettingsFrom(`${kind}=on,operational=${level}`, false).problems).toEqual([
          `HB_LOGS: ${kind}=on writes information lines, which operational=${level} would drop; set operational=info or debug, or ${kind}=off`,
        ])
    expect(logSettingsFrom('operational=warn', true).problems).toHaveLength(1)
    expect(logSettingsFrom('auditCopy=on,requests=on,operational=info', false).problems).toEqual([])
  })

  it('refuses an item with more than one value', () => {
    expect(logSettingsFrom('audit=full=junk', false).problems).toEqual([
      expect.stringMatching(/^HB_LOGS: "audit=full=junk" is not a log setting/),
    ])
  })

  it('writes a line at its level and every level more severe', () => {
    expect(isWrittenAt('info', 'error')).toBe(true)
    expect(isWrittenAt('info', 'info')).toBe(true)
    expect(isWrittenAt('info', 'debug')).toBe(false)
    expect(isWrittenAt('error', 'warn')).toBe(false)
    expect(isWrittenAt('off', 'error')).toBe(false)
    expect(isWrittenAt('debug', 'debug')).toBe(true)
  })
})
