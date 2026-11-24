import type { Load, Tell } from '../resource.ts'
import { type CodeName, codeNameIn, pathOf } from './code-name.ts'
import type { Recording } from './recording.ts'

/**
 * Records every resource of a state, found as `forgetSession` finds them, each under its key path. Walked
 * once, as the state was made: what is put in it later is never looked at, so its keys never become names.
 */
export const watchState = (state: object, recording: Recording): void => {
  for (const [path, found] of resourcesIn(state)) {
    const inside = found.inspect((move, refused) => watch.moved(move, refused))
    const watch = recording.watch(path, () => ({ inside: inside(), load: found.load.get() }))
    found.load.subscribe(watch.stepped)
  }
}

/** What the inspector needs of a resource; nothing of it reads the value. */
export interface Inspected {
  readonly inspect: (heard: Tell) => () => ReturnType<Parameters<Recording['watch']>[1]>['inside']
  readonly load: { readonly get: () => Load; readonly subscribe: (heard: () => void) => unknown }
}

function* resourcesIn(
  made: object,
  parent: CodeName | null = null,
): Generator<readonly [CodeName, Inspected]> {
  for (const [key, part] of Object.entries(made)) {
    const name = codeNameIn(made, key)
    if (name === null || typeof part !== 'object' || part === null) continue
    const path = pathOf(parent, name)
    if (isInspected(part)) yield [path, part]
    else if (Object.getPrototypeOf(part) === Object.prototype) yield* resourcesIn(part, path)
  }
}

const isInspected = (part: object): part is Inspected => 'inspect' in part && 'load' in part
