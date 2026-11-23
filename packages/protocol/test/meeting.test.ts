import { Result } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ATTENDANCE_STATES, CalendarReport, MeetingAttendance, MeetingInvite } from '../src/meeting.ts'

const pathsRefused = (input: unknown): ReadonlyArray<string> => {
  const decoded = CalendarReport.decode(input)
  return Result.isOk(decoded) ? [] : decoded.error.map((issue) => issue.path.join('.'))
}

const SENT = {
  outcome: 'sent',
  inviteUid: '040000008200E00074C5B7101A82E008@example.com',
  meetingUrl: 'https://meet.example.com/abc-defg-hij?pwd=k3y',
}

describe('a calendar report', () => {
  it('carries what the agent did, and for a sent invitation its id and meeting link', () => {
    expect(CalendarReport.decode(SENT)).toEqual(Result.ok(SENT))
    for (const outcome of ['accepted', 'declined', 'cancelled', 'conflict', 'failed'])
      expect(CalendarReport.decode({ outcome })).toEqual(Result.ok({ outcome }))
    expect(pathsRefused({ outcome: 'added' })).toEqual(['outcome'])
  })

  it('refuses anything else from the calendar: a title, a place, the attendees or a token', () => {
    expect(
      pathsRefused({
        ...SENT,
        title: 'Dentist',
        location: 'Main Street',
        attendees: ['ben@example.com'],
        accessToken: 'ya29.secret',
      }),
    ).toEqual(['title', 'location', 'attendees', 'accessToken'])
  })

  it('takes only an http or https meeting link', () => {
    for (const meetingUrl of ['http://meet.example.com/x', 'HTTPS://meet.example.com', 'https://a'])
      expect(pathsRefused({ outcome: 'sent', meetingUrl })).toEqual([])
    for (const meetingUrl of [
      'javascript:alert(1)',
      'ftp://meet.example.com',
      'https://',
      'https:///path',
      'https://meet.example.com/a b',
      ' https://meet.example.com',
      'see https://meet.example.com',
    ])
      expect([meetingUrl, pathsRefused({ outcome: 'sent', meetingUrl })]).toEqual([
        meetingUrl,
        ['meetingUrl'],
      ])
    const longest = `https://meet.example.com/${'x'.repeat(2000 - 25)}`
    expect(longest).toHaveLength(2000)
    expect(pathsRefused({ outcome: 'sent', meetingUrl: longest })).toEqual([])
    expect(pathsRefused({ outcome: 'sent', meetingUrl: `${longest}x` })).toEqual(['meetingUrl'])
  })

  it('takes an invitation id of printable characters without spaces, up to 255', () => {
    expect(pathsRefused({ outcome: 'sent', inviteUid: '!~' })).toEqual([])
    expect(pathsRefused({ outcome: 'sent', inviteUid: 'u'.repeat(255) })).toEqual([])
    for (const inviteUid of ['', 'u'.repeat(256), 'two words', 'line\nbreak', 'ünïcode'])
      expect([inviteUid, pathsRefused({ outcome: 'sent', inviteUid })]).toEqual([inviteUid, ['inviteUid']])
  })

  it('decodes every report it can describe back to itself', () => {
    fc.assert(
      fc.property(arbitrary(CalendarReport), (report) => {
        expect(CalendarReport.decode(report)).toEqual(Result.ok(report))
      }),
    )
  })
})

describe('a meeting on the wire', () => {
  it('reads an attendance state it does not know as unknown', () => {
    for (const state of ATTENDANCE_STATES) expect(MeetingAttendance.decode(state)).toEqual(Result.ok(state))
    expect(MeetingAttendance.read('tentative')).toEqual(Result.ok('unknown'))
  })

  it('names the invitation sent by hand with neither id nor link', () => {
    const byHand = { uid: null, meetingUrl: null }
    expect(MeetingInvite.decode(byHand)).toEqual(Result.ok(byHand))
  })
})
