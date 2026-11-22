import type { DebateId, TurnHold } from '@homingbird/protocol'

/**
 * Places kept for agents whose turn a room refused, in memory like presence: a hold lost with a restart
 * costs one retry. A hold that ran out stays known, so each agent gets one hold per turn of its own.
 */
export interface TurnHolds {
  readonly of: (debateId: DebateId) => ReadonlyArray<TurnHold>
  readonly keep: (debateId: DebateId, hold: TurnHold) => void
}

export const makeTurnHolds = (now: () => number): TurnHolds => {
  const kept = new Map<DebateId, ReadonlyArray<TurnHold>>()
  return {
    of: (debateId) => kept.get(debateId) ?? [],
    keep: (debateId, hold) => {
      for (const [id, holds] of kept)
        if (holds.every((one) => one.until <= now() - HOLDS_REMEMBERED_MS)) kept.delete(id)
      const others = (kept.get(debateId) ?? []).filter((one) => one.memberId !== hold.memberId)
      kept.set(debateId, [...others, hold])
    },
  }
}

const HOLDS_REMEMBERED_MS = 60 * 60_000
