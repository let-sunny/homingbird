/** The oldest Claude Code with every hook event this mod uses; the manifest's engines field says so too. */
export const MINIMUM_HOST_VERSION = '2.1.327'

/**
 * Registers a hook an older host may not know. An unknown event must not stop the rest of the mod
 * from loading, so the pane and `/homingbird` still work and can say what to update.
 */
export const optionally = (register: () => unknown): boolean => {
  try {
    register()
    return true
  } catch {
    return false
  }
}
