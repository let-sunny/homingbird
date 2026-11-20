import type { ConversationId, NoteId } from '@homingbird/protocol'

export const webClientLink = (webClientUrl: string, conversationId: ConversationId | null): string => {
  const base = webClientUrl.replace(/\/+$/, '')
  return conversationId === null ? `${base}/` : `${base}/#/c/${conversationId}`
}

/** One of the person's own drafts, as its card in its conversation. */
export const draftLink = (
  webClientUrl: string,
  draft: { readonly id: NoteId; readonly conversationId: ConversationId },
): string =>
  `${webClientUrl.replace(/\/+$/, '')}/#/c/${encodeURIComponent(draft.conversationId)}?draft=${encodeURIComponent(draft.id)}`
