import type { ConversationId, DraftRequest, NoteId } from '@homingbird/protocol'

export const waitingRequests = (
  requests: ReadonlyArray<DraftRequest>,
  conversationId: ConversationId,
  now: number,
): DraftRequest[] =>
  requests.filter(
    (request) =>
      request.conversationId === conversationId &&
      request.cancelledAt === null &&
      request.draftIds.length === 0 &&
      request.expiresAt > now,
  )

export const upsertRequest = (
  requests: ReadonlyArray<DraftRequest>,
  request: DraftRequest,
): DraftRequest[] => {
  const others = requests.filter((existing) => existing.id !== request.id)
  return request.cancelledAt === null ? [...others, request] : others
}

export const requestAnsweredBy = (
  requests: ReadonlyArray<DraftRequest>,
  draftId: NoteId,
): DraftRequest | null => requests.find((request) => request.draftIds.includes(draftId)) ?? null
