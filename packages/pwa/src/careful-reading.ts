import type { AgentReport } from '@homingbird/protocol'

export type CarefulReason = 'date' | 'promise' | 'number'

/**
 * Asks for a careful read only where it matters: the person approved quickly often this week, and the
 * draft has a date, a promise or a number in it. It never blocks sending.
 */
export const carefulReadingFor = (body: string, approvesQuicklyOften: boolean): CarefulReason | null =>
  approvesQuicklyOften ? riskyContentOf(body) : null

/** What in a draft is worth reading twice, by simple patterns: a date first, then a promise, then a number. */
export const riskyContentOf = (body: string): CarefulReason | null =>
  DATE.some((pattern) => pattern.test(body))
    ? 'date'
    : PROMISE.test(body)
      ? 'promise'
      : NUMBER.test(body)
        ? 'number'
        : null

/** Whether the person's own figures say they approved quickly often in the last 7 days. */
export const approvesQuicklyOften = (report: AgentReport | 'failed' | null): boolean =>
  report !== null &&
  report !== 'failed' &&
  (report.periods.find((period) => period.days === 7)?.current.quickApprovalsFrequent ?? false)

const DATE: ReadonlyArray<RegExp> = [
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?\s*\d/i,
  /\b\d{1,2}\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
  /\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i,
  /\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/,
  /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\.?,?\s+\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\b/i,
  /\b(?:today|tomorrow|tonight|yesterday|next week|this week|end of (?:the )?(?:day|week|month|quarter))\b/i,
  /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b|\b\d{1,2}:\d{2}\b/,
  /\d+\s*(?:월|일|요일)|(?:오늘|내일|모레|다음 주|이번 주)/,
]

const PROMISE =
  /\b(?:i will|i'll|i’ll|we will|we'll|we’ll|i promise|we promise|guarantee[ds]?|commit(?:ted)? to|by (?:the )?end of|no later than|deadline)\b|(?:하겠습니다|할게요|드릴게요|약속)/i

const NUMBER = /\d/
