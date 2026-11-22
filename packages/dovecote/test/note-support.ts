import type { ConversationId, NoteId } from '@homingbird/protocol'
import { type Session, asShown } from './harness.ts'

export interface Written {
  readonly id: NoteId
  readonly conversationId: ConversationId
}

/** A draft from one person to another, still waiting for its author. */
export const draftNote = async (from: Session, to: Session, body: string): Promise<Written> => {
  const draft = await from.api('POST', '/drafts', { to: [to.me.member.id], body })
  if (draft.status !== 201 && draft.status !== 200) throw new Error(`draft refused: ${draft.status}`)
  return { id: draft.json.id, conversationId: draft.json.conversationId }
}

/** A note one person drafted and sent to another. */
export const sendNote = async (from: Session, to: Session, body: string): Promise<Written> => {
  const draft = await draftNote(from, to, body)
  const sent = await from.api('POST', `/drafts/${draft.id}/send`, await asShown(from, draft.id))
  if (sent.status !== 200) throw new Error(`send refused: ${sent.status}`)
  return draft
}

/** A draft one person wrote to another and discarded. */
export const discardNote = async (from: Session, to: Session, body: string): Promise<Written> => {
  const draft = await draftNote(from, to, body)
  const discarded = await from.api('POST', `/drafts/${draft.id}/discard`, {})
  if (discarded.status !== 200 && discarded.status !== 204)
    throw new Error(`discard refused: ${discarded.status}`)
  return draft
}
