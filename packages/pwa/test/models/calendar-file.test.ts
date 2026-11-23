import { describe, expect, it } from 'vitest'
import { type MeetingForCalendar, meetingCalendarFile } from '../../src/models/calendar-file.ts'

const meeting = (fields: Partial<MeetingForCalendar> = {}): MeetingForCalendar => ({
  uid: 'invite-1@example.com',
  title: 'Planning sync',
  startsAt: Date.UTC(2026, 10, 19, 15),
  endsAt: Date.UTC(2026, 10, 19, 16),
  stampedAt: Date.UTC(2026, 10, 19, 12, 30, 5, 123),
  organizer: { name: 'Ana', email: 'ana@example.com' },
  attendees: [
    { name: 'Ana', email: 'ana@example.com' },
    { name: 'Ben', email: 'ben@example.com' },
  ],
  meetingUrl: null,
  ...fields,
})

const linesOf = (text: string): string[] => text.split('\r\n')

describe('meetingCalendarFile', () => {
  it('writes the time in UTC, the people and the id of the invitation, with CRLF line ends', () => {
    const file = meetingCalendarFile(meeting())
    expect(file.filename).toBe('meeting.ics')
    expect(file.mediaType).toBe('text/calendar;charset=utf-8')
    expect(linesOf(file.text.replace(/\r\n /g, ''))).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Homingbird//Meeting//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:invite-1@example.com',
      'DTSTAMP:20261119T123005Z',
      'DTSTART:20261119T150000Z',
      'DTEND:20261119T160000Z',
      'SUMMARY:Planning sync',
      'ORGANIZER;CN="Ana":mailto:ana@example.com',
      'ATTENDEE;CN="Ana";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:ana@example.com',
      'ATTENDEE;CN="Ben";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:ben@example.com',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ])
  })

  it('adds the meeting link as the place and the address when there is one', () => {
    const lines = linesOf(meetingCalendarFile(meeting({ meetingUrl: 'https://meet.example.com/abc' })).text)
    expect(lines).toContain('URL:https://meet.example.com/abc')
    expect(lines).toContain('LOCATION:https://meet.example.com/abc')
  })

  it('escapes what the format reserves in a title and keeps a name with a comma in its quotes', () => {
    const lines = linesOf(
      meetingCalendarFile(
        meeting({
          title: 'Plan; "budget", v1\\2\nsecond line',
          organizer: { name: 'Ana "A", Kim', email: 'ana@example.com' },
        }),
      ).text,
    )
    expect(lines).toContain('SUMMARY:Plan\\; "budget"\\, v1\\\\2\\nsecond line')
    expect(lines).toContain('ORGANIZER;CN="Ana  A , Kim":mailto:ana@example.com')
  })

  it('folds a long line at 75 octets without splitting a character', () => {
    const text = meetingCalendarFile(meeting({ title: '회의'.repeat(40) })).text
    const physical = linesOf(text)
    for (const line of physical) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(physical.some((line) => line.startsWith(' '))).toBe(true)
    expect(text.replace(/\r\n /g, '')).toContain(`SUMMARY:${'회의'.repeat(40)}`)
  })
})
