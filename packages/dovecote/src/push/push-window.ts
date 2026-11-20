/**
 * Lets one push through per key in each window and drops the rest: a burst of drafts in one channel is
 * one notification per reviewer, which opens the page where all of them wait.
 */
export const makePushWindow = (windowMs: number): PushWindow => {
  const lastAdmitted = new Map<string, number>()
  return {
    admits: (key, now) => {
      for (const [each, at] of lastAdmitted) if (now - at >= windowMs) lastAdmitted.delete(each)
      if (lastAdmitted.has(key)) return false
      lastAdmitted.set(key, now)
      return true
    },
  }
}

export interface PushWindow {
  readonly admits: (key: string, now: number) => boolean
}
