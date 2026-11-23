import { SCHEDULE_WINDOW_MAX_DAYS } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { schedulingRetryModel, widerWindow } from '../../src/models/scheduling-retry.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, debate } from '../support/fixtures.ts'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 19, 12)

const room = (status: 'open' | 'closed' | 'ended', result: 'slot' | 'no_slot' | null, createdBy = ANA) =>
  debate({
    type: 'scheduling',
    status,
    createdBy,
    result:
      result === null
        ? null
        : ({
            draftedBy: null,
            draftedAt: 1,
            result: { kind: result, ...(result === 'no_slot' && { closest: null }) },
          } as never),
    schedule: {
      minutes: 60,
      window: { startsAt: NOW + DAY, endsAt: NOW + 3 * DAY },
      attendees: [{ memberId: ANA, required: true, answer: 'by_agent' }],
    },
  })

describe('schedulingRetryModel', () => {
  it('offers the opener both ways to ask again once the flock settled', () => {
    const model = schedulingRetryModel({ debate: room('closed', 'slot'), viewerId: ANA, now: NOW })
    expect(model!.actions.map((action) => [action.name, action.label, action.emphasis])).toEqual([
      ['again', strings.scheduling.retryAgain, 'plain'],
      ['wider', strings.scheduling.retryWider, 'plain'],
    ])
    expect(model!.actions[0]!.window).toBeNull()
    expect(model!.actions[1]!.window).toEqual({ startsAt: NOW + DAY, endsAt: NOW + 10 * DAY })
  })

  it('stresses the wider window when no time was found or the flock ended', () => {
    for (const room_ of [room('closed', 'no_slot'), room('ended', null)])
      expect(schedulingRetryModel({ debate: room_, viewerId: ANA, now: NOW })!.actions[1]!.emphasis).toBe(
        'primary',
      )
  })

  it('offers nothing to anyone else, while the flock takes answers, or without a schedule', () => {
    expect(schedulingRetryModel({ debate: room('closed', 'slot'), viewerId: BEN, now: NOW })).toBeNull()
    expect(schedulingRetryModel({ debate: room('open', null), viewerId: ANA, now: NOW })).toBeNull()
    expect(schedulingRetryModel({ debate: debate({ status: 'closed' }), viewerId: ANA, now: NOW })).toBeNull()
  })
})

describe('widerWindow', () => {
  it('runs a week longer from no earlier than now', () => {
    expect(widerWindow({ startsAt: NOW - 2 * DAY, endsAt: NOW + DAY }, NOW)).toEqual({
      startsAt: NOW,
      endsAt: NOW + 8 * DAY,
    })
  })

  it('stays within the longest a flock may look', () => {
    const wider = widerWindow({ startsAt: NOW, endsAt: NOW + 10 * DAY }, NOW)
    expect(wider).toEqual({ startsAt: NOW, endsAt: NOW + SCHEDULE_WINDOW_MAX_DAYS * DAY })
  })

  it('moves on to the next week when the window is already the longest', () => {
    const longest = { startsAt: NOW, endsAt: NOW + SCHEDULE_WINDOW_MAX_DAYS * DAY }
    expect(widerWindow(longest, NOW)).toEqual({ startsAt: longest.endsAt, endsAt: longest.endsAt + 7 * DAY })
  })
})
