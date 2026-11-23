import { type Child, h } from '@homingbird/ui'
import type { ScheduleResultBody } from '../models/schedule-result.ts'

/** A scheduling result as headed lines: the time, or that there is none, then who is busy or did not answer. */
export const renderScheduleResult = (body: ScheduleResultBody): Child[] => [
  h('h3', {}, body.heading),
  ...body.lines.map((line, index) =>
    h('p', { class: index === 0 && body.outcome === 'slot' ? 'schedule-time' : 'schedule-line' }, line),
  ),
]
