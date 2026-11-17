import type { ConversationId } from '@homingbird/protocol'

export const webClientLink = (webClientUrl: string, conversationId: ConversationId | null): string => {
  const base = webClientUrl.replace(/\/+$/, '')
  return conversationId === null ? `${base}/` : `${base}/#/c/${conversationId}`
}
