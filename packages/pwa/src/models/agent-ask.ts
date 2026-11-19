import type { AsRead, CredentialId } from '@homingbird/protocol'
import { strings } from '../strings.ts'

/** The choice of agent when asking one to draft: only offered when the person has more than one. */
export const agentChoices = (
  agents: ReadonlyArray<AsRead.Credential>,
): ReadonlyArray<{ readonly value: string; readonly label: string }> | null =>
  agents.length <= 1
    ? null
    : [
        { value: '', label: strings.anyAgent },
        ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
      ]

/** The agent chosen, or null for any of them. */
export const chosenAgent = (value: string): CredentialId | null =>
  value === '' ? null : (value as CredentialId)
