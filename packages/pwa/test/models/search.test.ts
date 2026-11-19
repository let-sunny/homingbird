import { describe, expect, it } from 'vitest'
import { searchModel } from '../../src/models/search.ts'
import { timeShown } from '../../src/models/time.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, ROOM, conversation, member, note } from '../support/fixtures.ts'

const members = new Map([
  [ANA, member(ANA, 'Ana')],
  [BEN, member(BEN, 'Ben')],
])
const base = { conversations: [conversation()], members, viewerId: ANA, now: 10 }

describe('searchModel', () => {
  it('prompts before a search, shows that it searches, and says when nothing matched', () => {
    expect(searchModel({ ...base, results: null })).toEqual({ kind: 'prompt', text: strings.searchPrompt })
    expect(searchModel({ ...base, results: 'searching' })).toEqual({ kind: 'searching' })
    expect(searchModel({ ...base, results: [] })).toEqual({ kind: 'empty', text: strings.searchEmpty })
  })

  it('shows each note found with its author, conversation, time and an excerpt', () => {
    const found = note('n1', { body: 'x'.repeat(300), sentAt: 5 })
    const model = searchModel({ ...base, results: [found] })
    expect(model).toEqual({
      kind: 'results',
      rows: [
        {
          href: `#/c/${ROOM}`,
          author: 'Ben',
          title: 'Ben',
          time: timeShown(5, 10),
          excerpt: `${'x'.repeat(239)}…`,
        },
      ],
    })
  })

  it('names a former member, leaves out an unknown conversation, and dates a draft by its creation', () => {
    const found = note('n2', {
      authorId: CY,
      conversationId: 'conv_other0000000' as never,
      sentAt: null,
      createdAt: 3,
    })
    const model = searchModel({ ...base, results: [found] })
    expect(model.kind === 'results' && model.rows[0]).toMatchObject({
      author: strings.formerMember,
      title: null,
      time: timeShown(3, 10),
    })
  })
})
