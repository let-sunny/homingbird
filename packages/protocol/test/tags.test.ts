import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MemberId } from '../src/ids.ts'
import { NoteTags, TAGS_MAX, isAsked, isSameTags, tagsAsked } from '../src/tags.ts'

const ana = MemberId.of('ana000000000')
const ben = MemberId.of('ben000000000')
const cy = MemberId.of('cy0000000000')
const member = fc.constantFrom(ana, ben, cy, MemberId.of('dee000000000'))

describe('tagsAsked', () => {
  it('keeps the people a note tags, once each and in one order', () => {
    expect(tagsAsked({ authorId: ana, tags: [cy, ben, cy], answeredAuthorId: null })).toEqual([ben, cy])
  })

  it('never tags the author of the note', () => {
    expect(tagsAsked({ authorId: ana, tags: [ana, ben], answeredAuthorId: null })).toEqual([ben])
    expect(tagsAsked({ authorId: ana, tags: [ana], answeredAuthorId: null })).toEqual([])
  })

  it('asks everyone, the empty list, when a new note tags nobody', () => {
    expect(tagsAsked({ authorId: ana, tags: [], answeredAuthorId: null })).toEqual([])
  })

  it('asks the author of the note a reply answers when the reply tags nobody', () => {
    expect(tagsAsked({ authorId: ana, tags: [], answeredAuthorId: ben })).toEqual([ben])
  })

  it('lets a reply tag other people in place of the author it answers', () => {
    expect(tagsAsked({ authorId: ana, tags: [cy], answeredAuthorId: ben })).toEqual([cy])
  })

  it('asks everyone when a reply that tags nobody answers its own author', () => {
    expect(tagsAsked({ authorId: ana, tags: [], answeredAuthorId: ana })).toEqual([])
  })

  it('is settled once: asking again changes nothing', () => {
    fc.assert(
      fc.property(
        member,
        fc.array(member),
        fc.option(member, { nil: null }),
        (authorId, tags, answeredAuthorId) => {
          const once = tagsAsked({ authorId, tags, answeredAuthorId })
          expect(tagsAsked({ authorId, tags: once, answeredAuthorId })).toEqual(once)
          expect(once).not.toContain(authorId)
        },
      ),
    )
  })
})

describe('isAsked', () => {
  it('asks everyone when a note tags nobody or was stored before tags', () => {
    expect(isAsked([], ana)).toBe(true)
    expect(isAsked(undefined, ana)).toBe(true)
  })

  it('asks only the tagged people when a note tags someone', () => {
    expect(isAsked([ben], ben)).toBe(true)
    expect(isAsked([ben], ana)).toBe(false)
  })
})

describe('isSameTags', () => {
  it('compares the people named, whatever their order', () => {
    expect(isSameTags([ana, ben], [ben, ana])).toBe(true)
    expect(isSameTags([ana], [ana, ben])).toBe(false)
    expect(isSameTags([ana, ben], [ana])).toBe(false)
    expect(isSameTags([ana, cy], [ana, ben])).toBe(false)
  })

  it('reads a missing list as naming nobody', () => {
    expect(isSameTags(undefined, [])).toBe(true)
    expect(isSameTags([], undefined)).toBe(true)
    expect(isSameTags(undefined, [ana])).toBe(false)
  })
})

describe('NoteTags', () => {
  it('holds up to as many people as a group holds besides its author', () => {
    expect(
      NoteTags.decode(Array.from({ length: TAGS_MAX }, (_, i) => `mem_${String(i).padStart(12, '0')}`))._tag,
    ).toBe('Ok')
    expect(
      NoteTags.decode(Array.from({ length: TAGS_MAX + 1 }, (_, i) => `mem_${String(i).padStart(12, '0')}`))
        ._tag,
    ).toBe('Err')
    expect(TAGS_MAX).toBe(50)
  })
})
