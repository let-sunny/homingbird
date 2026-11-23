import { type Migration, optionalInteger, optionalString } from '../schema-steps.ts'

/**
 * A scheduling room may limit its meeting to some weekdays and some hours of the day, in the zone of
 * whoever opened it. A room stored before this step has no limit.
 */
export const SCHEDULING_LIMITS: Migration = [
  { addTo: 'scheduling_rooms', name: 'weekdays', column: optionalString },
  { addTo: 'scheduling_rooms', name: 'hours_from', column: optionalInteger },
  { addTo: 'scheduling_rooms', name: 'hours_to', column: optionalInteger },
  { addTo: 'scheduling_rooms', name: 'time_zone', column: optionalString },
]
