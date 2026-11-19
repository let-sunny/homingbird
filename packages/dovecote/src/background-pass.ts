import { Task as T } from '@homingbird/kernel'
import type { AppEnv } from './environment.ts'

/** Logs a failed pass and lets its loop go on: the loops share one race, so one ending stops them all. */
export const survivingPass = (name: string, pass: T.Task<void, never, AppEnv>): T.Task<void, never, AppEnv> =>
  T.flatMap((exit: T.Exit<void, never>): T.Task<void, never, AppEnv> => {
    if (exit._tag === 'Ok') return T.unit
    if (exit.error._tag === 'Interrupt') return T.fromExit(exit)
    const cause = exit.error._tag === 'Die' ? exit.error.defect : exit.error.error
    return T.map((env: AppEnv) =>
      env.log(`${name}: a pass failed and the next one runs as planned (${causeText(cause)})`),
    )(T.ask<AppEnv>())
  })(T.exit(pass))

export const backgroundEnded = (exit: T.Exit<never, never>): string =>
  exit._tag === 'Err' && exit.error._tag === 'Interrupt'
    ? 'Background work stopped for shutdown.'
    : `Background work stopped unexpectedly: housekeeping, debate deadlines, presence, audit forwarding and push no longer run (${exit._tag === 'Err' && exit.error._tag === 'Die' ? causeText(exit.error.defect) : 'no cause given'}). Restart Dovecote.`

const causeText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))
