import { Task as T } from '@homingbird/kernel'
import type { AppEnv } from './environment.ts'
import { type Log, defectNameOf, logDefect } from './log/operational-log.ts'

/** Logs a failed pass and lets its loop go on: the loops share one race, so one ending stops them all. */
export const survivingPass = (name: string, pass: T.Task<void, never, AppEnv>): T.Task<void, never, AppEnv> =>
  T.flatMap((exit: T.Exit<void, never>): T.Task<void, never, AppEnv> => {
    if (exit._tag === 'Ok') return T.unit
    if (exit.error._tag === 'Interrupt') return T.fromExit(exit)
    const cause = exit.error._tag === 'Die' ? exit.error.defect : exit.error.error
    return T.map((env: AppEnv) =>
      logDefect(
        env.log,
        { name: 'background.pass_failed', attributes: { pass: name, defect: defectNameOf(cause) } },
        cause,
      ),
    )(T.ask<AppEnv>())
  })(T.exit(pass))

/** Says why background work stopped: for shutdown, or unexpectedly, which needs a restart. */
export const logBackgroundEnded = (log: Log, exit: T.Exit<never, never>): void => {
  if (exit._tag === 'Err' && exit.error._tag === 'Interrupt') {
    log.emit({ name: 'background.shutdown', attributes: {} })
    return
  }
  const defect = exit._tag === 'Err' && exit.error._tag === 'Die' ? exit.error.defect : 'no cause given'
  logDefect(log, { name: 'background.stopped', attributes: { defect: defectNameOf(defect) } }, defect)
}
