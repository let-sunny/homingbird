import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { EventBody } from '../src/events.ts'
import { DebateId, MemberId } from '../src/ids.ts'
import { isWakingEvent } from '../src/waking-events.ts'

const ANA = MemberId.of('ana000000000')
const BEN = MemberId.of('ben000000000')

const noteBy = (authorId: MemberId) =>
  fc
    .sample(
      arbitrary(EventBody).filter((body) => body.type === 'note.sent'),
      1,
    )
    .map((body) => ({
      ...body,
      note: { ...(body as Extract<EventBody, { type: 'note.sent' }>).note, authorId },
    }))[0] as EventBody

describe('which events may mean work waits for an agent', () => {
  it('never wakes for a colleague’s draft preview changing', () => {
    expect(isWakingEvent({ type: 'preview.changed', conversationId: null }, ANA)).toBe(false)
    expect(isWakingEvent({ type: 'preview.changed', conversationId: null }, null)).toBe(false)
  })

  it('wakes for a colleague’s note, never for the person’s own', () => {
    expect(isWakingEvent(noteBy(BEN), ANA)).toBe(true)
    expect(isWakingEvent(noteBy(ANA), ANA)).toBe(false)
  })

  it('wakes for a debate room only when the person’s agent takes part in it', () => {
    const room = (participantIds: MemberId[]) =>
      ({ type: 'debate.changed', debateId: DebateId.of('room00000000'), participantIds }) as EventBody
    expect(isWakingEvent(room([BEN, ANA]), ANA)).toBe(true)
    expect(isWakingEvent(room([BEN]), ANA)).toBe(false)
  })

  it('wakes for a draft request and for a gap in the stream', () => {
    const request = fc.sample(
      arbitrary(EventBody).filter((body) => body.type === 'draft.requested'),
      1,
    )[0]!
    expect(isWakingEvent(request, ANA)).toBe(true)
    expect(isWakingEvent({ type: 'resync' }, ANA)).toBe(true)
  })

  it('wakes a listener that does not know whose stream it holds for every note and no room', () => {
    expect(isWakingEvent(noteBy(ANA), null)).toBe(true)
    expect(
      isWakingEvent(
        { type: 'debate.changed', debateId: DebateId.of('room00000000'), participantIds: [ANA] } as EventBody,
        null,
      ),
    ).toBe(false)
  })

  it('wakes for nothing else, whoever the viewer is', () => {
    const quiet = arbitrary(EventBody).filter(
      (body) => !['note.sent', 'debate.changed', 'draft.requested', 'resync'].includes(body.type),
    )
    fc.assert(
      fc.property(quiet, fc.constantFrom(ANA, null), (body, viewer) => {
        expect(isWakingEvent(body, viewer)).toBe(false)
      }),
      { numRuns: 200 },
    )
  })
})
