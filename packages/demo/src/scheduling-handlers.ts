import { Task as T } from '@homingbird/kernel'
import {
  type Adding,
  type AttendanceEvent,
  Conflict,
  DEFAULT_SCHEDULING_DELEGATION,
  type Debate,
  type DebateId,
  FREE_SLOTS_NOTE_MAX,
  Forbidden,
  Invalid,
  type MemberId,
  NotFound,
  SCHEDULE_WINDOW_MAX_DAYS,
  SCHEDULING_RULES,
  type ScheduleLimits,
  type ScheduleSetup,
  isMeetingPossible,
  limitsFor,
  scheduleLimitsProblem,
  windowAheadOf,
} from '@homingbird/protocol'
import { changeRoom, roomById } from './debate-script.ts'
import { type Handlers, found } from './handlers.ts'
import { connectedAgentOf, memberById } from './reads.ts'
import { agentsContinue, stepRoomAttendance } from './scheduling-invitation.ts'
import { agentsAnswerLater, ruleRoomOf, settleWhenAnswered, withAnswer } from './scheduling-script.ts'
import { VISITOR_ID } from './team.ts'
import type { World } from './world.ts'

/**
 * Scheduling flocks the visitor opens, answers and takes a settled meeting from, and what the visitor lets
 * their agent do about meetings. Colleagues' agents answer from scripted calendars; nothing is ever added
 * to a real one, so the visitor adds a settled meeting themself.
 */
export const schedulingHandlers = (world: World): Handlers => {
  let delegation = DEFAULT_SCHEDULING_DELEGATION
  const delegationView = (viewerId: MemberId) => ({
    delegation,
    agentInUse: delegation.agentId ?? connectedAgentOf(world.records(), viewerId, null)?.id ?? null,
  })
  const adding = (): Adding =>
    connectedAgentOf(world.records(), VISITOR_ID, null) === null
      ? 'person'
      : delegation.autoAdd
        ? 'agent'
        : 'agent_after_click'
  return {
    'me.scheduling.get': (_, viewerId) => T.sync(() => delegationView(viewerId)),
    'me.scheduling.set': ({ body }, viewerId) =>
      T.gen(function* () {
        if (body.agentId !== null && connectedAgentOf(world.records(), viewerId, body.agentId) === null)
          return yield* T.fail(NotFound({ message: 'No such connected agent.' }))
        delegation = body
        return delegationView(viewerId)
      }),
    'scheduling.create': ({ body }, viewerId) =>
      T.gen(function* () {
        const problem = setupProblem(world, viewerId, body)
        if (problem !== null) return yield* T.fail(Invalid({ message: problem }))
        return openRoom(world, viewerId, body, adding)
      }),
    'scheduling.slots.set': ({ params, body }, viewerId) =>
      T.gen(function* () {
        const debate = yield* roomOf(world, viewerId, params.id)
        if (debate.status !== 'open')
          return yield* T.fail(Conflict({ message: 'This flock no longer takes free times.' }))
        const problem = SCHEDULING_RULES.turnProblem(
          { memberId: viewerId, body: '', slots: body.slots },
          ruleRoomOf(debate),
        )
        if (problem !== null) return yield* T.fail(Invalid({ message: problem }))
        changeRoom(world, debate.id, (current) => ({
          ...current,
          schedule: withAnswer(current.schedule!, viewerId, 'by_person', body.slots),
        }))
        settleWhenAnswered(world, debate.id, adding)
        return yield* roomOf(world, viewerId, debate.id)
      }),
    'scheduling.attendance.add': ({ params }, viewerId) =>
      attend(world, viewerId, params.id, { type: 'add', memberId: viewerId }, adding),
    'scheduling.attendance.remove': ({ params }, viewerId) =>
      attend(world, viewerId, params.id, { type: 'remove', memberId: viewerId }, adding),
    'scheduling.retry': ({ params, body }, viewerId) =>
      T.gen(function* () {
        const debate = yield* roomOf(world, viewerId, params.id)
        if (debate.createdBy !== viewerId)
          return yield* T.fail(
            Forbidden({ message: 'Only the person who opened this flock can open it again.' }),
          )
        if (debate.status === 'open')
          return yield* T.fail(Conflict({ message: 'This flock still takes answers.' }))
        const schedule = debate.schedule!
        return openRoom(
          world,
          viewerId,
          {
            title: debate.question,
            minutes: schedule.minutes,
            window: body.window ?? schedule.window,
            ...limitsOf(schedule),
            attendees: schedule.attendees.filter((attendee) => attendee.memberId !== viewerId),
            visibility: debate.visibility === 'open' ? 'open' : 'private',
          },
          adding,
        )
      }),
  }
}

/** How long a flock takes answers. */
const ANSWERS_WITHIN_MINUTES = 120

const openRoom = (world: World, viewerId: MemberId, setup: ScheduleSetup, adding: () => Adding): Debate => {
  const now = world.clock.now()
  const others = setup.attendees.filter((attendee) => attendee.memberId !== viewerId)
  const agent = connectedAgentOf(world.records(), viewerId, null)
  const debate: Debate = {
    id: world.nextId('deb') as DebateId,
    type: 'scheduling',
    question: setup.title.trim(),
    visibility: setup.visibility ?? 'private',
    status: 'open',
    createdBy: viewerId,
    createdAt: now,
    deadlineAt: now + ANSWERS_WITHIN_MINUTES * 60_000,
    concludedAt: null,
    closedAt: null,
    endedBecause: null,
    limits: limitsFor(
      { turnsPerAgent: 1, minutes: ANSWERS_WITHIN_MINUTES, turnCharacters: FREE_SLOTS_NOTE_MAX },
      others.length + 1,
    ),
    memberIds: [viewerId, ...others.map((attendee) => attendee.memberId)],
    participants:
      agent === null
        ? []
        : [{ memberId: viewerId, agentId: agent.id, agentName: agent.name, joinedAt: now, takingPart: true }],
    turns: [],
    result: null,
    resultRound: 0,
    schedule: {
      minutes: setup.minutes,
      window: setup.window,
      ...limitsOf(setup),
      attendees: [
        { memberId: viewerId, required: true, answer: 'waiting' },
        ...others.map(({ memberId, required }) => ({ memberId, required, answer: 'waiting' as const })),
      ],
      invite: null,
      freeSlots: [],
    },
  }
  world.update((records) => ({ ...records, debates: [debate, ...records.debates] }))
  changeRoom(world, debate.id, (room) => room)
  agentsAnswerLater(world, debate.id, adding)
  return roomById(world, debate.id)!
}

const setupProblem = (world: World, viewerId: MemberId, setup: ScheduleSetup): string | null => {
  const others = setup.attendees.filter((attendee) => attendee.memberId !== viewerId)
  if (setup.title.trim() === '') return 'A scheduling flock needs a title.'
  if (setup.window.endsAt <= setup.window.startsAt) return 'The window ends after it starts.'
  if (setup.window.endsAt - setup.window.startsAt > SCHEDULE_WINDOW_MAX_DAYS * 86_400_000)
    return `The window is at most ${SCHEDULE_WINDOW_MAX_DAYS} days.`
  const limited = scheduleLimitsProblem(setup)
  if (limited !== null) return limited
  if (!isMeetingPossible(windowAheadOf(setup.window, world.clock.now()), setup.minutes, setup))
    return 'No time in the window that is still ahead fits the meeting inside the chosen days and hours.'
  if (others.length === 0) return 'Ask at least one other person to the meeting.'
  if (new Set(others.map((attendee) => attendee.memberId)).size !== others.length)
    return 'Ask each person once.'
  return others.some((attendee) => memberById(world.records(), attendee.memberId)?.kind !== 'person')
    ? 'Ask people, not channels.'
    : null
}

/** A click on a settled meeting moves the visitor's part of it, and the opener's also everyone else's. */
const attend = (
  world: World,
  viewerId: MemberId,
  id: string,
  event: AttendanceEvent,
  adding: () => Adding,
): T.Task<Debate, NotFound | Conflict> =>
  T.gen(function* () {
    const debate = yield* roomOf(world, viewerId, id)
    if (debate.status !== 'closed' || debate.result?.result.kind !== 'slot')
      return yield* T.fail(Conflict({ message: 'This flock has settled no meeting.' }))
    const step = stepRoomAttendance(world, debate, event, adding)
    if ('refusal' in step) return yield* T.fail(step.refusal)
    agentsContinue(world, debate.id, adding)
    return yield* roomOf(world, viewerId, id)
  })

/** The days and hours a flock is limited to, as they were set up. */
const limitsOf = (limits: ScheduleLimits): ScheduleLimits => ({
  ...(limits.weekdays !== undefined && { weekdays: limits.weekdays }),
  ...(limits.hours !== undefined && { hours: limits.hours }),
  ...(limits.timeZone !== undefined && { timeZone: limits.timeZone }),
})

const roomOf = (world: World, viewerId: MemberId, id: string): T.Task<Debate, NotFound> =>
  found(
    world
      .records()
      .debates.find(
        (debate) => debate.id === id && debate.type === 'scheduling' && debate.memberIds.includes(viewerId),
      ),
    'No such scheduling flock.',
  )
