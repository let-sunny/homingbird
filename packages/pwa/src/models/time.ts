import { formats } from '../strings.ts'

/** A moment as a list or a note shows it: the time today, the day before that, the full date on hover. */
export const timeShown = (timestamp: number, now: number): TimeShown => {
  const date = new Date(timestamp)
  const sameDay = new Date(now).toDateString() === date.toDateString()
  return {
    datetime: date.toISOString(),
    title: formats.full.format(date),
    text: (sameDay ? formats.time : formats.day).format(date),
  }
}

/** A moment in full, or the fallback when there is none. */
export const dateTimeText = (timestamp: number | null, fallback: string): string =>
  timestamp === null ? fallback : formats.full.format(new Date(timestamp))

export interface TimeShown {
  readonly datetime: string
  readonly title: string
  readonly text: string
}
