import type { CharacterSpec } from './character-spec.ts'
import type { Frame, Rect } from './grid.ts'
import { BODY_TAIL, mirror } from './pip-parts.ts'
import { STATES, type StateName } from './states.ts'

/** Every state for a character, frame for frame: Pip's frames with the character's markings added. */
export const statesFor = (spec: CharacterSpec): Readonly<Record<StateName, ReadonlyArray<Frame>>> => {
  const states = {} as Record<StateName, ReadonlyArray<Frame>>
  for (const [name, frames] of Object.entries(STATES) as Array<[StateName, ReadonlyArray<Frame>]>) {
    states[name] = frames.map((frame) => ({
      ...frame,
      rects: dress(frame.rects, spec.marks, name === 'returning', spec.noFeet ?? false),
    }))
  }
  return states
}

/** Inserts markings right after the body, under the eyes and icons, and drops the feet for `noFeet`. */
export const dress = (
  rects: ReadonlyArray<Rect>,
  marks: ReadonlyArray<Rect>,
  isMirrored: boolean,
  hasNoFeet: boolean,
): Rect[] => {
  const tail = isMirrored ? mirror([BODY_TAIL])[0]! : BODY_TAIL
  const placed = isMirrored ? mirror(marks) : marks
  const dressed: Rect[] = []
  for (const rect of rects) {
    if (hasNoFeet && rect[4] === 'F') continue
    dressed.push(rect)
    if (isSameRect(rect, tail)) dressed.push(...placed)
  }
  return dressed
}

const isSameRect = (a: Rect, b: Rect): boolean => a.every((value, i) => value === b[i])
