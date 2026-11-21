import type { AsRead } from '@homingbird/protocol'
import { lifetime, signal } from '@homingbird/ui'
import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { answeredBefore } from '../../src/views/answered-before.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, ROOM, conversation, entry, note } from '../support/fixtures.ts'

usingFakeDom()

const earlier: AsRead.EarlierAnswer = {
  question: note('q1', { authorId: ANA, body: 'Where do we keep the release calendar?' }),
  answer: note('a1', { authorId: BEN, body: 'In Drive, under Releases.', inReplyTo: 'q1' as never }),
  channel: 'wiki',
}

const setup = (replying = false) => {
  const test = testContext()
  test.context.state.directory.set([entry(BEN, 'Ben')])
  const typed = signal('')
  let cleared = 0
  const shown = answeredBefore(test.context, lifetime(), ROOM, {
    typed,
    isReplying: () => replying,
    clear: () => {
      cleared += 1
      typed.set('')
    },
  })
  return { ...test, shown, typed, cleared: () => cleared }
}

describe('answeredBefore', () => {
  it('shows a question still open in a channel’s room as the person types the same one, and nowhere else', () => {
    const { shown, typed, context } = setup()
    const asked = note('q9', { authorId: BEN, body: 'What is the refund rule for annual plans?', sentAt: 1 })
    context.state.threads.set(new Map([[ROOM, { notes: [asked], hasMore: false }]]))
    context.state.conversations.set([conversation({ kind: 'direct' })])
    typed.set('Refund rule for annual plans?')
    expect(textOf(shown)).not.toContain(strings.answeredBefore.askedTitle)
    context.state.conversations.set([conversation({ kind: 'channel' })])
    expect(getByRole(shown, 'region', { name: strings.answeredBefore.askedTitle })).toBeDefined()
    expect(getByRole(shown, 'link', { name: strings.answeredBefore.openQuestion }).getAttribute('href')).toBe(
      `#/c/${ROOM}?note=q9`,
    )
  })

  it('looks up the question being typed and shows what was found, without touching Send', () => {
    const { shown, typed, called } = setup()
    typed.set('Where is the release calendar kept?')
    const [lookUp] = called('findEarlierAnswers')
    expect(lookUp!.args.slice(0, 2)).toEqual(['Where is the release calendar kept?', ROOM])
    expect((lookUp!.args[2] as () => boolean)()).toBe(true)
    lookUp!.then!.done!([earlier])
    expect(getByRole(shown, 'region', { name: strings.answeredBefore.title })).toBeDefined()
    expect(textOf(shown)).toContain('In Drive, under Releases.')
    expect(textOf(shown)).toContain(strings.answeredBefore.approvedBy({ name: 'Ben' }))
    expect(getByRole(shown, 'link', { name: strings.answeredBefore.open }).getAttribute('href')).toBe(
      `#/c/${ROOM}`,
    )
  })

  it('drops what an earlier lookup found once the person typed on, and looks the same question up once', () => {
    const { shown, typed, called } = setup()
    typed.set('release calendar')
    typed.set('release calendar ')
    typed.set('release calendar link')
    const [first, second] = called('findEarlierAnswers')
    expect(called('findEarlierAnswers')).toHaveLength(2)
    expect((first!.args[2] as () => boolean)()).toBe(false)
    first!.then!.done!([earlier])
    expect(textOf(shown)).not.toContain('In Drive')
    second!.then!.done!([])
    expect(textOf(shown)).toBe('')
  })

  it('records that an earlier answer answered it, clears the composer and says nothing was sent', () => {
    const { shown, typed, called, cleared } = setup()
    typed.set('release calendar')
    called('findEarlierAnswers')[0]!.then!.done!([earlier])
    getByRole(shown, 'button', { name: strings.answeredBefore.thisAnswersIt }).click()
    expect(called('markAnsweredFromHistory')[0]!.args).toEqual(['a1', ROOM])
    expect(called('sendNote')).toHaveLength(0)
    expect(cleared()).toBe(1)
    expect(textOf(shown)).toContain(strings.answeredBefore.answered)
    typed.set('Another question about deploys')
    expect(textOf(shown)).not.toContain(strings.answeredBefore.answered)
  })

  it('hides the answers when the person keeps writing, until the composer is emptied', () => {
    const { shown, typed, called } = setup()
    typed.set('release calendar')
    called('findEarlierAnswers')[0]!.then!.done!([earlier])
    getByRole(shown, 'button', { name: strings.answeredBefore.keepWriting }).click()
    expect(textOf(shown)).toBe('')
    typed.set('')
    typed.set('release calendar')
    called('findEarlierAnswers')[1]!.then!.done!([earlier])
    expect(textOf(shown)).toContain('In Drive')
  })

  it('looks nothing up while replying to a note', () => {
    const { typed, called } = setup(true)
    typed.set('Where is the release calendar kept?')
    expect(called('findEarlierAnswers')).toHaveLength(0)
  })
})
