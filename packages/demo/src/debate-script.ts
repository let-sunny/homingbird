import {
  type Debate,
  type DebateAskedTurn,
  type DebateParticipant,
  type DebateResult,
  type MemberId,
  isTakingPart,
  turnWaitMs,
} from '@homingbird/protocol'
import { memberById } from './reads.ts'
import type { World } from './world.ts'

/**
 * A room the visitor opened: a few seconds later a colleague's agent joins it, the first person invited
 * or, in an open room, Ana; once the visitor's agent takes part too, the scripted debate begins.
 */
export const colleagueJoinsLater = (world: World, debateId: string, colleagueId: MemberId | null): void => {
  if (colleagueId === null) return
  world.after(DEBATE_JOIN_AFTER_MS, () => {
    const room = roomById(world, debateId)
    const colleague = memberById(world.records(), colleagueId)
    if (room === null || colleague === null || room.status !== 'open') return
    const participant: DebateParticipant = {
      memberId: colleague.id,
      agentId: null,
      agentName: `${colleague.name.split(' ')[0]}'s laptop`,
      joinedAt: world.clock.now(),
      takingPart: true,
    }
    changeRoom(world, debateId, (current) => ({
      ...current,
      memberIds: current.memberIds.includes(colleague.id)
        ? current.memberIds
        : [...current.memberIds, colleague.id],
      participants: [...current.participants, participant],
    }))
    debateLater(world, debateId)
  })
}

/**
 * Plays a room's debate on the world's clock once two agents take part and none has spoken: the room asks
 * one agent at a time, in join order, the agents take their turns, then the room closes with the result
 * they settled, which only a person posts.
 */
export const debateLater = (world: World, debateId: string): void => {
  const room = roomById(world, debateId)
  if (room === null || room.status !== 'open' || room.turns.length > 0) return
  const speakers = room.participants.filter(isTakingPart)
  if (speakers.length < 2) return
  const count = Math.min(SCRIPT.length, room.limits.totalTurns, room.limits.turnsPerAgent * speakers.length)
  const askedAfter = (position: number): DebateAskedTurn | null => {
    if (position >= count) return null
    const order = speakers.map((_, index) => speakers[(position + index) % speakers.length]!.memberId)
    return { memberId: order[0]!, until: world.clock.now() + turnWaitMs(room.limits), next: order.slice(1) }
  }
  changeRoom(world, debateId, (each) => ({ ...each, askedTurn: askedAfter(0) }))
  const step = (position: number): void =>
    world.after(DEBATE_TURN_AFTER_MS, () => {
      const current = roomById(world, debateId)
      if (current === null || current.status !== 'open' || current.turns.length !== position - 1) return
      if (position > count) return conclude(world, current)
      const speaker = speakers[(position - 1) % speakers.length]!
      changeRoom(world, debateId, (each) => ({
        ...each,
        turns: [
          ...each.turns,
          {
            position,
            memberId: speaker.memberId,
            agentName: speaker.agentName,
            body: SCRIPT[position - 1]!.slice(0, each.limits.turnCharacters),
            at: world.clock.now(),
          },
        ],
        askedTurn: askedAfter(position),
      }))
      step(position + 1)
    })
  step(1)
}

/** How long a colleague's agent takes to join a new room, and each agent to take a turn. */
export const DEBATE_JOIN_AFTER_MS = 3_000
export const DEBATE_TURN_AFTER_MS = 4_000

/** The room with this id as it stands now, or null. */
export const roomById = (world: World, id: string): Debate | null =>
  world.records().debates.find((debate) => debate.id === id) ?? null

/** Changes one room and tells everyone in it, as a server's `debate.changed`. */
export const changeRoom = (world: World, id: string, change: (debate: Debate) => Debate): Debate => {
  world.update((records) => ({
    ...records,
    debates: records.debates.map((debate) => (debate.id === id ? change(debate) : debate)),
  }))
  const changed = roomById(world, id)!
  const participantIds = changed.participants.map((participant) => participant.memberId)
  world.emit([...new Set([...changed.memberIds, ...participantIds])], {
    type: 'debate.changed',
    debateId: changed.id,
    participantIds,
  })
  return changed
}

const conclude = (world: World, room: Debate): void => {
  const now = world.clock.now()
  const [first, second] = room.participants.filter(isTakingPart)
  const drafter = room.participants.find((participant) => participant.agentId !== null) ?? second!
  const voter = drafter.memberId === first!.memberId ? second! : first!
  changeRoom(world, room.id, (current) => ({
    ...current,
    status: 'closed',
    concludedAt: now,
    closedAt: now,
    result: {
      result: resultFor(first!.memberId, second!.memberId),
      draftedBy: drafter.memberId,
      draftedAt: now,
    },
    resultRound: 1,
    voteRecord: { votes: [{ voterId: voter.memberId, draftBy: drafter.memberId }], droppedOut: [] },
  }))
}

const resultFor = (opener: MemberId, answerer: MemberId): DebateResult => ({
  kind: 'conclusion',
  conclusion:
    'Go ahead, with a way back: whoever proposes it owns the rollback, picks a quiet day and tells the channel two days before.',
  reasons: [
    'Undoing it takes under an hour, by the steps in the plan.',
    'Timing is the real risk, so the day is chosen and announced in advance.',
  ],
  contributions: [
    { memberId: opener, summary: 'Asked for a way back and an owner for it.', credits: ['position_changed'] },
    {
      memberId: answerer,
      summary: 'Showed it can be undone within an hour and proposed announcing the day.',
      credits: ['gap_filled'],
    },
  ],
  nextSteps: [
    { step: 'Pick the day and tell the channel two days before.', owner: answerer, proposedBy: opener },
  ],
})

const SCRIPT: ReadonlyArray<string> = [
  'My view: we can do it, as long as there is a way back. If it goes wrong, how fast can we undo it?',
  'Within an hour; the steps are in the plan. The real risk is timing, so I would pick a quiet day and say so in advance.',
  'Then I agree, on one condition: whoever proposes it owns the rollback and is around that day.',
  'Agreed. I will own it, pick the day, and tell the channel two days before.',
]
