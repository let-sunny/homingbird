import type { AsRead, MemberId } from '@homingbird/protocol'
import type { Signal } from '@homingbird/ui'
import { schedulingAgentModel } from '../models/scheduling-agent.ts'
import { schedulingAttendanceModel } from '../models/scheduling-attendance.ts'
import { schedulingRetryModel } from '../models/scheduling-retry.ts'
import { schedulingSlotsModel } from '../models/scheduling-slots.ts'
import type { Block } from './blocks.ts'
import type { ViewContext } from './context.ts'
import type { Unsaved } from './parts.ts'
import { schedulingAgentCard } from './scheduling-agent.ts'
import { schedulingAttendanceCard } from './scheduling-attendance.ts'
import { schedulingRetryCard } from './scheduling-retry.ts'
import { schedulingSlotsCard } from './scheduling-slots.ts'

/**
 * What a person can do in a scheduling flock, as blocks: each is drawn again only when what it shows
 * changes. What only the moment of a click decides, such as a file's time stamp, is worked out then.
 */
export const schedulingCards = (
  context: ViewContext,
  input: SchedulingCards,
): ReadonlyArray<Block | null> => {
  const { debate, viewerId, agents, members } = input
  const person = { debate, viewerId, hasAgent: agents.length > 0 }
  const now = context.clock.now()
  const timeZone = context.page.timeZone()
  const agent = schedulingAgentModel(input)
  const slots = schedulingSlotsModel({ debate, viewerId, now, timeZone, showAllHours: true })
  const attendance = schedulingAttendanceModel({ ...input, hasAgent: person.hasAgent, now })
  const retry = schedulingRetryModel({ debate, viewerId, now })
  const names = debate.schedule?.attendees.map((one) => members.get(one.memberId)?.name)
  const meeting = [debate.id, debate.question, debate.schedule, debate.result]
  return [
    card('agent', agent, [debate.id], () => schedulingAgentCard(context, input)),
    card('slots', slots, [debate.id], (drawing) => schedulingSlotsCard(context, drawing, input)),
    card(
      'attendance',
      attendance && { ...attendance, calendarFile: attendance.calendarFile !== null },
      [meeting, names],
      () => schedulingAttendanceCard(context, { ...input, hasAgent: person.hasAgent }),
    ),
    card(
      'retry',
      retry && { ...retry, actions: retry.actions.map((action) => ({ ...action, window: null })) },
      meeting,
      () => schedulingRetryCard(context, person),
    ),
  ]
}

export interface SchedulingCards {
  readonly debate: AsRead.Debate
  readonly viewerId: MemberId
  readonly agents: ReadonlyArray<AsRead.Credential>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly unsaved: Unsaved
  readonly picked: Signal<ReadonlySet<number> | null>
  readonly showsAll: Signal<boolean>
}

const card = (
  key: string,
  model: unknown,
  facts: ReadonlyArray<unknown>,
  draw: (drawing: Parameters<Block['draw']>[0]) => HTMLElement | null,
): Block | null =>
  model === null ? null : { key, from: [model, facts], draw: (drawing) => draw(drawing) as HTMLElement }
