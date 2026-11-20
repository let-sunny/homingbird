import type { AsRead, ConversationId } from '@homingbird/protocol'
import { strings } from '../strings.ts'
import { isMuted } from '../thread.ts'

/**
 * The mute switch of a conversation, named for the conversation so a list of them reads well; none while
 * muting is off or in an archived room, which can receive nothing.
 */
export const muteToggleModel = (
  conversation: AsRead.Conversation,
  title: string,
  muteOn: boolean,
): MuteToggle | null => {
  if (!muteOn || conversation.archivedAt !== null) return null
  const muted = isMuted(conversation)
  return {
    conversationId: conversation.id,
    muted,
    text: muted ? strings.mute.unmute : strings.mute.mute,
    label: muted ? strings.mute.unmuteName({ name: title }) : strings.mute.muteName({ name: title }),
    mark: muted ? strings.mute.muted : null,
    hint: strings.mute.hint,
  }
}

export interface MuteToggle {
  readonly conversationId: ConversationId
  readonly muted: boolean
  /** What the button says: the action it takes. */
  readonly text: string
  /** What it is called, with the conversation's name. */
  readonly label: string
  /** The word shown beside a muted conversation's name. */
  readonly mark: string | null
  readonly hint: string
}
