/**
 * The meeting as an iCalendar file (RFC 5545), for a person without a calendar tool in their agent to add
 * to their own calendar: the time in UTC, the people invited, and the meeting link when there is one.
 */
export const meetingCalendarFile = (meeting: MeetingForCalendar): CalendarFile => ({
  text: `${lines(meeting).map(folded).join('\r\n')}\r\n`,
  mediaType: 'text/calendar;charset=utf-8',
  filename: 'meeting.ics',
})

export interface MeetingForCalendar {
  /** The invitation's UID when the opener's calendar sent one; a stable one made from the flock otherwise. */
  readonly uid: string
  readonly title: string
  readonly startsAt: number
  readonly endsAt: number
  /** When the file is made, in epoch milliseconds. */
  readonly stampedAt: number
  readonly organizer: Person
  readonly attendees: ReadonlyArray<Person>
  readonly meetingUrl: string | null
}

export interface Person {
  readonly name: string
  readonly email: string
}

export interface CalendarFile {
  readonly text: string
  readonly mediaType: string
  readonly filename: string
}

const lines = (meeting: MeetingForCalendar): ReadonlyArray<string> => [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Homingbird//Meeting//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  `UID:${meeting.uid}`,
  `DTSTAMP:${utc(meeting.stampedAt)}`,
  `DTSTART:${utc(meeting.startsAt)}`,
  `DTEND:${utc(meeting.endsAt)}`,
  `SUMMARY:${escaped(meeting.title)}`,
  `ORGANIZER;CN=${quoted(meeting.organizer.name)}:mailto:${meeting.organizer.email}`,
  ...meeting.attendees.map(
    (person) =>
      `ATTENDEE;CN=${quoted(person.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:${person.email}`,
  ),
  ...(meeting.meetingUrl === null ? [] : [`URL:${meeting.meetingUrl}`, `LOCATION:${meeting.meetingUrl}`]),
  'END:VEVENT',
  'END:VCALENDAR',
]

/** 20261119T150000Z */
const utc = (timestamp: number): string =>
  new Date(timestamp)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '')

const escaped = (text: string): string =>
  text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** A parameter value cannot hold a double quote, and is quoted so that a comma or a colon stays in it. */
const quoted = (text: string): string => `"${text.replace(/["\r\n]/g, ' ')}"`

const LINE_OCTETS = 75

/** Lines longer than 75 octets continue on the next line after one space, never inside a character. */
const folded = (line: string): string => {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let octets = 0
  for (const character of line) {
    const size = encoder.encode(character).length
    const limit = parts.length === 0 ? LINE_OCTETS : LINE_OCTETS - 1
    if (octets + size > limit) {
      parts.push(current)
      current = ''
      octets = 0
    }
    current += character
    octets += size
  }
  parts.push(current)
  return parts.join('\r\n ')
}
