import { describe, expect, it } from 'vitest'
import {
  type ComposerTagsInput,
  asksLine,
  composerTagsModel,
  mentionAt,
  withMentionChosen,
} from '../../src/models/composer-tags.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, conversation, entry, member, note, serverInfo } from '../support/fixtures.ts'
import { threadInput } from '../support/thread.ts'

const group = conversation({ kind: 'group', participantIds: [ANA, BEN, CY] })
const members = new Map([
  [ANA, member(ANA, 'Ana')],
  [BEN, member(BEN, 'Ben')],
  [CY, member(CY, 'Cy')],
])

const inputOf = (fields: Partial<ComposerTagsInput> = {}): ComposerTagsInput => ({
  ...threadInput({
    conversations: [group],
    members,
    directory: [
      entry(ANA, 'Ana'),
      entry(BEN, 'Ben'),
      entry(CY, 'Cy'),
      entry('mem_dee000000000' as never, 'Dee'),
    ],
  }),
  chosen: [],
  mention: null,
  active: null,
  ...fields,
})

describe('composerTagsModel', () => {
  it('says everyone’s agent drafts a reply to a new note that tags nobody', () => {
    const model = composerTagsModel(inputOf())!
    expect(model.notice).toBe(strings.tags.everyone)
    expect(model.picker.chips).toEqual([])
    expect(model.picker.expanded).toBe(false)
    expect(model.hint).toBe(strings.hints.tagging)
  })

  it('says only the tagged people’s agents draft, one or several', () => {
    expect(composerTagsModel(inputOf({ chosen: [BEN] }))!.notice).toBe(strings.tags.onlyOne({ name: 'Ben' }))
    const both = composerTagsModel(inputOf({ chosen: [BEN, CY] }))!
    expect(both.notice).toBe(strings.tags.onlyMany({ names: 'Ben and Cy' }))
    expect(both.picker.chips.map((chip) => chip.name)).toEqual(['Ben', 'Cy'])
  })

  it('says a reply that tags nobody asks the author of the note it answers', () => {
    const question = note('q', { authorId: CY })
    const model = composerTagsModel(
      inputOf({ thread: { notes: [question], hasMore: false }, replyTarget: question.id }),
    )!
    expect(model.notice).toBe(strings.tags.reply({ name: 'Cy' }))
  })

  it('lists the people in the group matching the @ being typed, never the person or anyone outside', () => {
    const model = composerTagsModel(inputOf({ mention: { start: 0, query: '' } }))!
    expect(model.picker.expanded).toBe(true)
    expect(model.picker.options.map((option) => option.name)).toEqual(['Ben', 'Cy'])
    const typed = composerTagsModel(inputOf({ mention: { start: 0, query: 'cy' }, active: CY }))!
    expect(typed.picker.options.map((option) => option.name)).toEqual(['Cy'])
    expect(typed.picker.activeId).toBe(`composer-tags-${CY}`)
  })

  it('offers no tagging in a direct message or while tagging is off', () => {
    expect(composerTagsModel({ ...inputOf(), conversations: [conversation()] })).toBeNull()
    expect(composerTagsModel({ ...inputOf(), serverInfo: serverInfo({}) })).toBeNull()
    expect(composerTagsModel({ ...inputOf(), conversations: [] })).toBeNull()
  })
})

describe('mentionAt', () => {
  it('finds the @ that starts a word just before the caret, and what follows it', () => {
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionAt('Hi @be', 6)).toEqual({ start: 3, query: 'be' })
    expect(mentionAt('Hi @be and', 6)).toEqual({ start: 3, query: 'be' })
  })

  it('finds none in an address, after a space, or with nothing typed', () => {
    expect(mentionAt('ana@example.com', 15)).toBeNull()
    expect(mentionAt('Hi @ben ', 8)).toBeNull()
    expect(mentionAt('', 0)).toBeNull()
  })
})

describe('withMentionChosen', () => {
  it('writes the chosen name in place of what was typed, with one space after it', () => {
    expect(withMentionChosen('Hi @be', { start: 3, query: 'be' }, 'Ben')).toEqual({
      text: 'Hi @Ben ',
      caret: 8,
    })
    expect(withMentionChosen('Hi @be there', { start: 3, query: 'be' }, 'Ben')).toEqual({
      text: 'Hi @Ben there',
      caret: 8,
    })
  })
})

describe('asksLine', () => {
  it('names whom a note asks, and nothing for a note that tags nobody or while tagging is off', () => {
    const input = threadInput({ members })
    expect(asksLine(input, { tags: [BEN, CY] })).toBe(strings.tags.asks({ names: 'Ben and Cy' }))
    expect(asksLine(input, { tags: ['mem_gone00000000' as never] })).toBe(
      strings.tags.asks({ names: strings.formerMember }),
    )
    expect(asksLine(input, {})).toBeNull()
    expect(asksLine(input, { tags: [] })).toBeNull()
    expect(asksLine({ ...input, serverInfo: serverInfo({}) }, { tags: [BEN] })).toBeNull()
  })
})
