import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { ConversationId, MemberId, NoteId, Timestamp } from './ids.ts'
import { ChannelSlug, NOTE_BODY_MAX } from './model.ts'

/** Whom a person lets see their own agent's unconfirmed drafts; empty, the default, previews nothing. */
export const DraftPreviewAllowance = S.struct({
  people: S.array(MemberId, { maxItems: 200 }),
  channels: S.array(ChannelSlug, { maxItems: 200 }),
})
export type DraftPreviewAllowance = S.Infer<typeof DraftPreviewAllowance>

export const NO_DRAFT_PREVIEWS: DraftPreviewAllowance = { people: [], channels: [] }

/** A draft as an allowed viewer sees it: its words, gone once withdrawn, and whose agent wrote it. */
export const DraftPreview = S.struct({
  noteId: NoteId,
  conversationId: ConversationId,
  authorId: MemberId,
  agentName: S.nullable(S.string({ maxLength: 200 })),
  inReplyTo: S.nullable(NoteId),
  state: S.tolerant(S.literal('unconfirmed', 'withdrawn'), UNKNOWN),
  body: S.nullable(S.string({ maxLength: NOTE_BODY_MAX })),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type DraftPreview = S.Infer<typeof DraftPreview>

export interface PreviewPlace {
  readonly kind: string
  readonly participantIds: ReadonlyArray<MemberId>
  readonly channel: string | null
  readonly isPrivateQuestion: boolean
}

/** A private question, and a kind of place this code does not know, preview to nobody. */
export const previewViewers = (
  allowance: DraftPreviewAllowance,
  authorId: MemberId,
  place: PreviewPlace,
): MemberId[] => {
  if (place.isPrivateQuestion) return []
  const others = place.participantIds.filter((memberId) => memberId !== authorId)
  if (place.kind === 'channel') return allowance.channels.some((slug) => slug === place.channel) ? others : []
  if (place.kind === 'direct' || place.kind === 'group')
    return others.filter((memberId) => allowance.people.includes(memberId))
  return []
}

export const isPreviewableDraft = (draft: {
  readonly status: string
  readonly agentName: string | null
  readonly fromDebate?: unknown
}): boolean => draft.status === 'draft' && draft.agentName !== null && draft.fromDebate === undefined
