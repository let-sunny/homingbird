import { describe, expect, it } from 'vitest'
import { tagsToSend } from '../src/tagging.ts'
import { ANA, BEN, CY, conversation } from './support/fixtures.ts'

const group = conversation({ kind: 'group', participantIds: [ANA, BEN, CY] })
const base = { room: group, authorId: ANA, chosen: [], answered: null, taggingOn: true } as const

describe('tagsToSend', () => {
  it('tags nobody in a direct message, a channel, a private question, or while tagging is off', () => {
    expect(tagsToSend({ ...base, room: conversation() })).toBeNull()
    expect(tagsToSend({ ...base, room: conversation({ kind: 'channel' }) })).toBeNull()
    expect(tagsToSend({ ...base, room: { ...group, privateQuestionOf: 'billing' as never } })).toBeNull()
    expect(tagsToSend({ ...base, taggingOn: false })).toBeNull()
    expect(tagsToSend({ ...base, room: undefined })).toBeNull()
  })

  it('asks everyone with a new note that tags nobody', () => {
    expect(tagsToSend(base)).toEqual({ tags: [], asked: [] })
  })

  it('keeps only the people in the group, once each, never the author', () => {
    const gone = 'mem_gone00000000' as never
    expect(tagsToSend({ ...base, chosen: [CY, gone, CY, ANA] })).toEqual({ tags: [CY], asked: [CY] })
  })

  it('asks the author of the note a reply answers while it tags nobody, if they are still in the group', () => {
    expect(tagsToSend({ ...base, answered: { authorId: BEN } })).toEqual({ tags: [], asked: [BEN] })
    expect(tagsToSend({ ...base, answered: { authorId: 'mem_gone00000000' as never } })).toEqual({
      tags: [],
      asked: [],
    })
    expect(tagsToSend({ ...base, chosen: [CY], answered: { authorId: BEN } })).toEqual({
      tags: [CY],
      asked: [CY],
    })
  })
})
