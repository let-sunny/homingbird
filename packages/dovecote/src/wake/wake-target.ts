import { type DeskWakeHeader, isReservedWakeHeader } from '@homingbird/protocol'
import { isFetchableHostName } from '../auth/client-metadata.ts'

export interface WakeTarget {
  readonly url: string
  readonly headers: ReadonlyArray<DeskWakeHeader>
}

/** Why a wake may not be saved, in one sentence, or null. */
export const wakeTargetProblem = (target: WakeTarget, allowedHosts: ReadonlyArray<string>): string | null => {
  const url = URL.canParse(target.url) ? new URL(target.url) : null
  if (url === null || url.protocol !== 'https:') return 'The wake address must be an https address.'
  if (url.port !== '') return 'The wake address must use the default https port.'
  if (url.username !== '' || url.password !== '')
    return 'The wake address must not carry a user name or password.'
  if (target.url.includes('#')) return 'The wake address must not carry a fragment.'
  if (!isFetchableHostName(url.hostname) || !allowedHosts.includes(url.hostname))
    return allowedHosts.length === 0
      ? 'This server allows no wake addresses; its operator sets HB_WAKE_HOSTS.'
      : `The wake address must be on ${allowedHosts.join(', ')}, the hosts this server allows.`
  const names = target.headers.map((header) => header.name.toLowerCase())
  const reserved = target.headers.find((header) => isReservedWakeHeader(header.name))
  if (reserved !== undefined) return `The header ${reserved.name} is set by the server and cannot be changed.`
  if (new Set(names).size !== names.length) return 'Name each header once.'
  return null
}

export const wakeHostOf = (target: WakeTarget): string => new URL(target.url).hostname

/** No note and no name: only that work waits, and where. */
export const wakeBody = (publicUrl: string): string =>
  JSON.stringify({ text: `Homingbird: work is waiting at ${publicUrl}.` })
