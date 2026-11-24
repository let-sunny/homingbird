import type { Clock } from '@homingbird/kernel'
import { type Entry, type Recording, createRecording } from '../../src/inspector/recording.ts'
import { watchState } from '../../src/inspector/watched-state.ts'

/** Records the resources of a state, or of any object that holds some, for a test to read or print. */
export const recordOf = (state: object, clock: Clock): Recording => {
  const recording = createRecording(clock)
  watchState(state, recording)
  return recording
}

/** The timeline, a line each and the oldest first, which a failing test prints as its message. */
export const timelineText = (recording: Recording): string =>
  recording
    .snapshot()
    .timeline.map((entry) => `+${entry.at}ms ${textOf(entry)}`)
    .join('\n')

/** Runs the checks of a test, and adds the timeline to what they throw. */
export const withTimeline = async <A>(recording: Recording, checks: () => Promise<A>): Promise<A> => {
  try {
    return await checks()
  } catch (failed) {
    if (failed instanceof Error) failed.message += `\n\nWhat the resources did:\n${timelineText(recording)}`
    throw failed
  }
}

const textOf = (entry: Entry): string => {
  switch (entry.kind) {
    case 'move':
      return words(entry.path, entry.move, entry.error)
    case 'step':
      return words(entry.path, '=>', entry.step, entry.loaded ? 'loaded' : 'not loaded', entry.error)
    case 'request':
      return words(entry.route, entry.outcome, entry.status, entry.ms === null ? null : `${entry.ms}ms`)
  }
}

const words = (...parts: ReadonlyArray<string | number | null>): string =>
  parts.filter((part) => part !== null).join(' ')
