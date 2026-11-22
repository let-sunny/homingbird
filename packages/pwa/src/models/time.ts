import { formats, strings } from '../strings.ts'

/** A moment as a list or a note shows it: the time today, the day before that, the full date on hover. */
export const timeShown = (timestamp: number, now: number): TimeShown => {
  const date = new Date(timestamp)
  return {
    datetime: date.toISOString(),
    title: formats.full.format(date),
    text: (isSameDay(timestamp, now) ? formats.time : formats.day).format(date),
  }
}

/** A sent note's moment: the time today, and the day with the time before that, so both can be read. */
export const noteTimeShown = (timestamp: number, now: number): TimeShown => {
  const shown = timeShown(timestamp, now)
  return isSameDay(timestamp, now) ? shown : { ...shown, text: formats.dayTime.format(new Date(timestamp)) }
}

/** The heading over a day's notes in a thread: today, yesterday, or the date, with its year if another. */
export const dayHeading = (timestamp: number, now: number): string => {
  if (isSameDay(timestamp, now)) return strings.today
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameDay(timestamp, yesterday.getTime())) return strings.yesterday
  const date = new Date(timestamp)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return (sameYear ? formats.date : formats.dateWithYear).format(date)
}

/** Whether two moments fall on the same day where the person is. */
export const isSameDay = (one: number, other: number): boolean =>
  new Date(one).toDateString() === new Date(other).toDateString()

/** A moment in full, or the fallback when there is none. */
export const dateTimeText = (timestamp: number | null, fallback: string): string =>
  timestamp === null ? fallback : formats.full.format(new Date(timestamp))

export interface TimeShown {
  readonly datetime: string
  readonly title: string
  readonly text: string
}
