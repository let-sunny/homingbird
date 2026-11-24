import type { AsRead } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { draftsBehindModel } from '../../src/models/drafts-behind.ts'
import { timeShown } from '../../src/models/time.ts'
import { strings } from '../../src/strings.ts'
import { ROOM, report } from '../support/fixtures.ts'

const DAY = 24 * 60 * 60_000
const NOW = 40 * DAY

const miss = (outcome: string, id: string, daysAgo: number, place: string | null = 'billing') =>
  ({
    outcome,
    noteId: `note_${id}`,
    conversationId: ROOM,
    place,
    at: NOW - daysAgo * DAY,
  }) as AsRead.AgentMiss

describe('draftsBehindModel', () => {
  it('groups the misses of the period by what happened, each opening its conversation or teaching', () => {
    const shown = draftsBehindModel(
      report({
        generatedAt: NOW,
        misses: [
          miss('skipped', 'skipped00000', 1, null),
          miss('edited', 'edited000000', 2),
          miss('discarded', 'discarded000', 3),
          miss('edited', 'edited000001', 6),
          miss('edited', 'tooold000000', 9),
          miss('unknown', 'future000000', 1),
        ],
      }),
      7,
    )!
    expect(shown.title).toBe(strings.teach.behindTitle)
    expect(shown.intro).toBe(strings.teach.behindIntro)
    expect(shown.groups.map((group) => [group.outcome, group.title])).toEqual([
      ['edited', strings.teach.behind.edited({ count: 2 })],
      ['discarded', strings.teach.behind.discarded({ count: 1 })],
      ['skipped', strings.teach.behind.skipped({ count: 1 })],
    ])
    expect(shown.groups[0]!.rows[0]).toEqual({
      key: 'edited:note_edited000000',
      place: '#billing',
      time: timeShown(NOW - 2 * DAY, NOW),
      href: `#/c/${ROOM}?note=note_edited000000`,
      open: strings.teach.openConversation,
      teach: strings.teach.add,
      seed: { topic: '', place: 'billing' },
    })
    expect(shown.groups[1]!.rows[0]!.href).toBe(`#/c/${ROOM}`)
    expect(shown.groups[2]!.rows[0]).toMatchObject({
      place: strings.trust.directMessages,
      seed: { topic: '', place: null },
    })
    expect(
      draftsBehindModel(report({ generatedAt: NOW, misses: [miss('edited', 'tooold000000', 9)] }), 30),
    ).not.toBeNull()
  })

  it('shows nothing while loading, or with no miss in the period', () => {
    expect(draftsBehindModel(null, 7)).toBeNull()
    expect(draftsBehindModel(report(), 7)).toBeNull()
    expect(
      draftsBehindModel(report({ generatedAt: NOW, misses: [miss('edited', 'old000000000', 8)] }), 7),
    ).toBeNull()
  })
})
