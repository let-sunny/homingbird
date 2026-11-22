import type { NoteId } from '@homingbird/protocol'
import { h } from '@homingbird/ui'
import { textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { renderDraftPreviews } from '../../src/views/draft-previews.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const shown = (model: Parameters<typeof renderDraftPreviews>[0]) =>
  mount(h('div', {}, ...renderDraftPreviews(model)))

describe('renderDraftPreviews', () => {
  it('draws an unconfirmed draft as a muted card with its words as text, and nothing to reply or quote with', () => {
    const view = shown({
      cards: [
        {
          noteId: 'note_preview00000' as NoteId,
          withdrawn: false,
          title: 'Unconfirmed draft',
          note: 'Not checked yet',
          body: '<b>Early</b> words',
        },
      ],
      ownNotice: null,
    })
    const card = view.querySelector('.draft-preview')!
    expect(card.getAttribute('aria-label')).toBe('Unconfirmed draft')
    expect(card.getAttribute('data-note-id')).toBe('note_preview00000')
    expect(card.querySelector('.draft-preview-body')!.textContent).toBe('<b>Early</b> words')
    expect(card.querySelector('b')).toBeNull()
    expect(card.querySelector('button')).toBeNull()
    expect(card.classList.contains('is-withdrawn')).toBe(false)
  })

  it('draws a withdrawn draft without words, and the author’s line on who can see theirs', () => {
    const view = shown({
      cards: [
        {
          noteId: 'note_gone000000000' as NoteId,
          withdrawn: true,
          title: 'Withdrawn',
          note: 'Never sent',
          body: null,
        },
      ],
      ownNotice: 'Ben can see it',
    })
    expect(view.querySelector('.draft-preview.is-withdrawn .draft-preview-body')).toBeNull()
    expect(textOf(view)).toContain('Never sent')
    expect(view.querySelector('.draft-preview-own')!.getAttribute('role')).toBe('status')
    expect(textOf(view)).toContain('Ben can see it')
  })
})
