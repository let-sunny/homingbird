import type { AsRead, CredentialId } from '@homingbird/protocol'
import { deskUnavailableReason } from '../presence.ts'
import { strings } from '../strings.ts'

/**
 * The choice of agent when asking one to draft: only offered when the person has more than one, or when
 * the one they had chosen is gone and they have to choose again.
 */
export const agentChoices = (
  agents: ReadonlyArray<AsRead.Credential>,
  mustChoose = false,
): ReadonlyArray<{ readonly value: string; readonly label: string }> | null =>
  agents.length <= 1 && !mustChoose
    ? null
    : [
        { value: '', label: strings.anyAgent },
        ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
      ]

/** The agent chosen, or null for any of them. */
export const chosenAgent = (value: string): CredentialId | null =>
  value === '' ? null : (value as CredentialId)

/**
 * Whether the person may ask their agent for a draft here: never where the server takes no draft
 * requests, and not while their own desk runs but its agent cannot answer, with the reason.
 */
export const agentAskReach = (
  draftRequestsOn: boolean,
  myPresence: AsRead.Presence | undefined,
): { readonly may: true } | { readonly may: false; readonly reason: string } => {
  if (!draftRequestsOn) return { may: false, reason: strings.askAgentOff }
  const [unavailable] = deskUnavailableReason(myPresence ?? null)
  return unavailable === undefined ? { may: true } : { may: false, reason: unavailable }
}
