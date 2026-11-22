import { h } from '@homingbird/ui'
import type { DraftPreviewsModel } from '../models/draft-previews.ts'

/**
 * Unconfirmed drafts shown early, as muted cards that offer no reply, quote or copy, and the author's
 * own line on who can see theirs. The text goes in as text, never as markup.
 */
export const renderDraftPreviews = (model: DraftPreviewsModel): ReadonlyArray<HTMLElement> => [
  ...model.cards.map((card) =>
    h(
      'article',
      {
        class: `draft-preview${card.withdrawn ? ' is-withdrawn' : ''}`,
        data: { noteId: card.noteId },
        'aria-label': card.title,
      },
      h('p', { class: 'draft-preview-title' }, card.title),
      card.body !== null && h('p', { class: 'draft-preview-body' }, card.body),
      h('p', { class: 'draft-preview-note' }, card.note),
    ),
  ),
  ...(model.ownNotice === null
    ? []
    : [h('p', { class: 'hint draft-preview-own', role: 'status' }, model.ownNotice)]),
]
