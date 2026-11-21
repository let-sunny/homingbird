import type { ConversationId, MemberId } from '@homingbird/protocol'
import type { PageStorage } from './browser-page.ts'

/** The unsent text this browser kept for a person, by conversation; nothing when none was kept or it is unreadable. */
export const keptComposerTexts = (
  storage: PageStorage,
  memberId: MemberId,
): ReadonlyMap<ConversationId, string> => {
  const stored = storage.local(storageKeyFor(memberId))
  if (stored === null) return new Map()
  try {
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Map()
    return new Map(
      Object.entries(parsed).flatMap(([id, text]) =>
        typeof text === 'string' && text.trim() !== '' ? [[id as ConversationId, text] as const] : [],
      ),
    )
  } catch {
    return new Map()
  }
}

/** The texts with one conversation's text set, or removed when nothing but spaces is left. */
export const withComposerText = (
  texts: ReadonlyMap<ConversationId, string>,
  id: ConversationId,
  text: string,
): ReadonlyMap<ConversationId, string> => {
  const next = new Map(texts)
  if (text.trim() === '') next.delete(id)
  else next.set(id, text)
  return next
}

/** Keeps the texts in this browser, or forgets them when none is left. */
export const keepComposerTexts = (
  storage: PageStorage,
  memberId: MemberId,
  texts: ReadonlyMap<ConversationId, string>,
): void => {
  if (texts.size === 0) storage.removeLocal(storageKeyFor(memberId))
  else storage.setLocal(storageKeyFor(memberId), JSON.stringify(Object.fromEntries(texts)))
}

/** Forgets a person's unsent texts in this browser, as when they sign out. */
export const forgetComposerTexts = (storage: PageStorage, memberId: MemberId): void =>
  storage.removeLocal(storageKeyFor(memberId))

const storageKeyFor = (memberId: MemberId): string => `${STORAGE_PREFIX}${memberId}`

const STORAGE_PREFIX = 'homingbird.composer.'
