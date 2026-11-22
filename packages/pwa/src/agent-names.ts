import type { AsRead } from '@homingbird/protocol'
import { strings } from './strings.ts'

/**
 * Where the agent that wrote a note runs, in words that follow "Your agent": in Claude Code, on the
 * computer the runner runs on, or on the connection any other agent signed in as. The Claude Code desk
 * and the runner both sign in as "Homingbird CLI on <host>", so they are told apart by the program they
 * reported.
 */
export const agentNameOf = (note: Pick<AsRead.Note, 'agentName' | 'agentClient'>): string | null => {
  const kind = agentKindOf(note.agentClient ?? null)
  if (kind === 'desk') return strings.agentNames.desk
  if (kind === 'runner') {
    const host = hostIn(note.agentName)
    return host === null ? strings.agentNames.runnerUnnamed : strings.agentNames.runner({ host })
  }
  return note.agentName === null ? null : strings.agentNames.connection({ name: note.agentName })
}

export type AgentKind = 'desk' | 'runner' | 'other'

/** Which integration reported a program label: the plugin's `Claude Code <version>`, the runner's `<agent> via homingbird run`. */
export const agentKindOf = (client: string | null): AgentKind => {
  if (client === null) return 'other'
  if (client === DESK_CLIENT || client.startsWith(`${DESK_CLIENT} `)) return 'desk'
  if (client === RUNNER_CLIENT || client.endsWith(` via ${RUNNER_CLIENT}`)) return 'runner'
  return 'other'
}

/** The computer a default connection name gives, or the name a person chose instead. */
const hostIn = (agentName: string | null): string | null => {
  if (agentName === null || agentName.trim() === '') return null
  return DEFAULT_CONNECTION_NAME.exec(agentName)?.[1]?.trim() || agentName
}

const DESK_CLIENT = 'Claude Code'
const RUNNER_CLIENT = 'homingbird run'
const DEFAULT_CONNECTION_NAME = /^Homingbird CLI on (.+)$/
