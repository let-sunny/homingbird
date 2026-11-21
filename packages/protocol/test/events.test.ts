import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  EventBody,
  type EventType,
  HEARTBEAT_SECONDS,
  POLL_WAIT_MAX_SECONDS,
  STREAM_PATHS,
  StreamEvent,
  isDurable,
} from '../src/events.ts'

const types: EventType[] = [
  'note.sent',
  'note.status',
  'draft.saved',
  'draft.discarded',
  'draft.requested',
  'draft.request.changed',
  'contact.changed',
  'presence',
  'directory.changed',
  'channel.changed',
  'channel.left',
  'debate.changed',
  'group.changed',
  'review.changed',
  'note.released',
  'resync',
]

describe('stream events', () => {
  it('round-trips every generated event through JSON', () => {
    fc.assert(
      fc.property(arbitrary(StreamEvent), (event) => {
        expect(StreamEvent.decode(JSON.parse(JSON.stringify(event)))).toMatchObject({ _tag: 'Ok' })
      }),
      { numRuns: 100 },
    )
  })

  it('generates every event type', () => {
    const seen = new Set(fc.sample(arbitrary(EventBody), 400).map((body) => body.type))
    expect([...seen].sort()).toEqual([...types].sort())
  })

  it('treats presence, directory, debate room, group and review changes and resync as ephemeral, and everything else as durable', () => {
    expect(types.filter((type) => !isDurable(type))).toEqual([
      'presence',
      'directory.changed',
      'debate.changed',
      'group.changed',
      'review.changed',
      'resync',
    ])
  })

  it('refuses an unknown event type and reports the discriminator', () => {
    const decoded = EventBody.decode({ type: 'note.approved' })
    expect(decoded).toMatchObject({ _tag: 'Err', error: [{ path: ['type'] }] })
  })

  it('reports presence for humans and agents separately', () => {
    const member = { memberId: 'mem_abcdefghijkl', humanOnline: true, agentOnline: false }
    expect(EventBody.is({ type: 'presence', members: [member] })).toBe(true)
    expect(EventBody.is({ type: 'presence', members: [{ ...member, agentOnline: undefined }] })).toBe(false)
  })

  it('publishes the transport paths and timings', () => {
    expect(STREAM_PATHS).toEqual({
      sse: '/api/v1/events/stream',
      ws: '/api/v1/events/ws',
      poll: '/api/v1/events/poll',
    })
    expect(HEARTBEAT_SECONDS).toBeLessThan(POLL_WAIT_MAX_SECONDS + 10)
    expect(POLL_WAIT_MAX_SECONDS).toBeLessThan(100)
  })
})
