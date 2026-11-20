import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { NoteId } from '../src/ids.ts'
import { noteIdOfNoticeTag, noticeTag } from '../src/notice-tags.ts'

describe('notice tags', () => {
  it('reads back the draft a tag was made for', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('review' as const, 'draft' as const),
        arbitrary(NoteId),
        (kind, id) => noteIdOfNoticeTag(kind, noticeTag(kind, id)) === id,
      ),
    )
  })

  it('reads no draft from a tag of another kind, an empty id or no tag', () => {
    expect(noticeTag('review', 'n1')).toBe('review:n1')
    expect(noteIdOfNoticeTag('draft', 'review:n1')).toBeNull()
    expect(noteIdOfNoticeTag('review', 'review:')).toBeNull()
    expect(noteIdOfNoticeTag('review', '')).toBeNull()
    expect(noteIdOfNoticeTag('review', 'reviewer:n1')).toBeNull()
  })
})
