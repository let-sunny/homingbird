import type { Debate, DebateSummary, MemberId } from '@homingbird/protocol'

/** What a list shows of a room that is not a plain debate: a meeting, with the viewer's part, or a suggested room. */
export const roomKindFields = (
  debate: Debate,
  viewerId: MemberId,
): Pick<DebateSummary, 'type' | 'fromSuggestion' | 'mine'> => {
  if (debate.type !== 'scheduling') return debate.fromSuggestion === true ? { fromSuggestion: true } : {}
  const own = debate.schedule?.attendees.find((attendee) => attendee.memberId === viewerId)
  return {
    type: 'scheduling',
    ...(own !== undefined && {
      mine: {
        answer: own.answer ?? 'waiting',
        ...(own.attendance !== undefined && { attendance: own.attendance }),
        notices: [],
      },
    }),
  }
}
