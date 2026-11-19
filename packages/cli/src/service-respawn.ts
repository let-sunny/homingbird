import type { Invocation } from './arguments.ts'

/**
 * How `homingbird run --service` starts on Windows, where the Run key opens it in a console window: it
 * starts itself again, detached and hidden, marked so that the copy does not do the same, and exits.
 */
export const respawnFor = (
  platform: string,
  invocation: Invocation | null,
  variables: Readonly<Record<string, string | undefined>>,
): Respawn | null => {
  if (platform !== 'win32' || invocation?.command !== 'run' || invocation.isService !== true) return null
  if (variables[RESPAWNED] === '1') return null
  return {
    options: { detached: true, windowsHide: true, stdio: 'ignore' },
    environment: { ...variables, [RESPAWNED]: '1' },
  }
}

export interface Respawn {
  readonly options: { readonly detached: true; readonly windowsHide: true; readonly stdio: 'ignore' }
  readonly environment: Readonly<Record<string, string | undefined>>
}

/** Named like every Homingbird variable, so the runner never hands it to an agent command. */
export const RESPAWNED = 'HOMINGBIRD_SERVICE_RESPAWNED'
