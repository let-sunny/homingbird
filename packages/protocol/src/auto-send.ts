import { Schema as S } from '@homingbird/kernel'
import type * as AsRead from './as-read.ts'
import { ConversationId, type MemberId } from './ids.ts'

/** Whether a draft is exactly a saved answer's text, ignoring only the whitespace around either. */
export const isSavedAnswerText = (body: string, answer: string): boolean => {
  const text = answer.trim()
  return text !== '' && body.trim() === text
}

export const mayRecall = (
  note: Pick<AsRead.Note, 'authorId' | 'status' | 'autoSent' | 'sentAt'>,
  viewerId: MemberId,
  now: number,
): boolean =>
  note.authorId === viewerId &&
  note.status === 'sent' &&
  note.autoSent === true &&
  note.sentAt !== null &&
  now - note.sentAt < RECALL_WINDOW_MS

export const AUTO_SENT_NOTICE =
  'It is exactly a saved answer your human switched to send automatically here, so it was sent as their approval. Only your human can recall it, in the web client, within five minutes.'

export const RECALL_WINDOW_MS = 5 * 60_000

export const AUTO_SEND_PLACES_MAX = 20

/** A saved answer's switch and the conversations where it may send itself; set only by its person. */
export const AutoSend = S.struct({
  enabled: S.boolean,
  places: S.array(ConversationId, { maxItems: AUTO_SEND_PLACES_MAX }),
})
export type AutoSend = S.Infer<typeof AutoSend>

export const AUTO_SEND_OFF: AutoSend = { enabled: false, places: [] }
