import { describe, expect, it } from 'vitest'
import { searchModel } from '../../src/models/search.ts'
import { timeShown } from '../../src/models/time.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, ROOM, conversation, member, note } from '../support/fixtures.ts'

const members = new Map([
  [ANA, member(ANA, 'Ana')],
  [BEN, member(BEN, 'Ben')],
])
const base = { conversations: [conversation()], members, viewerId: ANA, now: 10, query: '' }

describe('searchModel', () => {
  it('prompts before a search, shows that it searches, and says when nothing matched', () => {
    expect(searchModel({ ...base, results: null })).toEqual({ kind: 'prompt', text: strings.searchPrompt })
    expect(searchModel({ ...base, results: 'searching' })).toEqual({ kind: 'searching' })
    expect(searchModel({ ...base, results: [] })).toEqual({ kind: 'empty', text: strings.searchEmpty })
  })

  it('shows each note found with its author, time and an excerpt, naming no direct message twice, and opens the thread at it', () => {
    const found = note('n1', { body: 'x'.repeat(300), sentAt: 5 })
    const model = searchModel({ ...base, results: [found] })
    expect(model).toEqual({
      kind: 'results',
      rows: [
        {
          href: `#/c/${ROOM}?note=n1`,
          author: 'Ben',
          title: null,
          time: timeShown(5, 10),
          excerpt: [{ text: `${'x'.repeat(239)}…`, isMatch: false }],
        },
      ],
    })
  })

  it('names the conversation when it is not just the author', () => {
    const found = note('n3', { authorId: ANA, sentAt: 5 })
    const model = searchModel({ ...base, results: [found] })
    expect(model.kind === 'results' && model.rows[0]).toMatchObject({ author: 'Ana', title: 'Ben' })
  })

  it('marks every place the excerpt contains what was searched for, ignoring case', () => {
    const found = note('n4', { body: 'Refund the bill? Billing (refunds) said no.', sentAt: 5 })
    const excerpt = (query: string) => {
      const model = searchModel({ ...base, query, results: [found] })
      return model.kind === 'results' ? model.rows[0]!.excerpt : []
    }
    expect(excerpt(' bill ')).toEqual([
      { text: 'Refund the ', isMatch: false },
      { text: 'bill', isMatch: true },
      { text: '? ', isMatch: false },
      { text: 'Bill', isMatch: true },
      { text: 'ing (refunds) said no.', isMatch: false },
    ])
    expect(excerpt('(refunds)')).toEqual([
      { text: 'Refund the bill? Billing ', isMatch: false },
      { text: '(refunds)', isMatch: true },
      { text: ' said no.', isMatch: false },
    ])
    expect(excerpt('Refund the')[0]).toEqual({ text: 'Refund the', isMatch: true })
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
