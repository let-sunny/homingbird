import type { MemberId } from '@homingbird/protocol'
import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { suggestionCardModel } from '../../src/models/debate-suggestion-card.ts'
import { hrefFor } from '../../src/routes.ts'
import { strings } from '../../src/strings.ts'
import { debateSuggestionCard } from '../../src/views/debate-suggestion-card.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, entry, me, member, suggestion } from '../support/fixtures.ts'

usingFakeDom()

const DEE = 'mem_dee000000000' as MemberId

const shown = (fields: Parameters<typeof suggestion>[0] = {}) => {
  const { context, called, page } = testContext()
  const directory = [entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy'), entry(DEE, 'Dee')]
  context.state.directory.set(directory)
  const card = suggestionCardModel({
    suggestion: suggestion(fields),
    members: new Map([
      [BEN, member(BEN, 'Ben')],
      [CY, member(CY, 'Cy')],
    ]),
    directory,
    viewerId: ANA,
  })
  const element = mount(debateSuggestionCard(context, lifetime(), me(), card))
  return { context, called, page, element }
}

describe('debateSuggestionCard', () => {
  it('shows the agent’s reason, the question and the colleagues, and what the room is', () => {
    const { element } = shown()
    const text = textOf(element)
    expect(text).toContain('Desk would like to talk this over with Ben and Cy before answering.')
    expect(text).toContain('Billing and support both touch the refund flow.')
    expect(text).toContain(strings.debateSuggestion.limits({ minutes: 30 }))
    getByRole(element, 'textbox', { name: strings.debateSuggestion.questionLabel })
    getByRole(element, 'button', { name: 'Remove Ben' })
    getByRole(element, 'button', { name: 'Remove Cy' })
  })

  it('opens the room with the question and people as edited, and goes to the room', () => {
    const { element, called, page } = shown()
    fire.type(getByRole(element, 'textbox', { name: strings.debateSuggestion.questionLabel }), 'Ship Friday?')
    getByRole(element, 'button', { name: 'Remove Cy' }).click()
    getByRole(element, 'button', { name: strings.debateSuggestion.open }).click()
    const [opened] = called('acceptSuggestion')
    expect(opened!.args).toEqual([suggestion().id, { question: 'Ship Friday?', memberIds: [BEN] }])
    opened!.then!.done!({ id: 'debate_000000000000' })
    expect(page.visited).toEqual(['go #/debate/debate_000000000000'])
  })

  it('says why it cannot be opened, and opens nothing', () => {
    const { element, called } = shown()
    getByRole(element, 'button', { name: 'Remove Ben' }).click()
    getByRole(element, 'button', { name: 'Remove Cy' }).click()
    getByRole(element, 'button', { name: strings.debateSuggestion.open }).click()
    expect(getByRole(element, 'alert').textContent).toBe(strings.debateSuggestion.peopleEmpty)
    expect(called('acceptSuggestion')).toEqual([])
  })

  it('answers alone without opening a room, and says so', () => {
    const { element, called, context } = shown()
    getByRole(element, 'button', { name: strings.debateSuggestion.dismiss }).click()
    const [dismissed] = called('dismissSuggestion')
    expect(dismissed!.args).toEqual([suggestion().id])
    dismissed!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.debateSuggestion.dismissed })
    expect(called('acceptSuggestion')).toEqual([])
  })

  it('names the agents that are not awake and links to a group note instead, keeping the room', () => {
    const { element } = shown()
    const text = textOf(element)
    expect(text).toContain(strings.debateSuggestion.notAwake({ people: 'Ben and Cy' }))
    expect(text).toContain(strings.debateSuggestion.askInNote)
    expect(
      getByRole(element, 'link', { name: strings.debateSuggestion.askInNoteLink }).getAttribute('href'),
    ).toBe(hrefFor({ name: 'new', to: [BEN, CY] }))
    getByRole(element, 'button', { name: strings.debateSuggestion.open })
  })

  it('leaves out the person who asked the note, even when the agent named them', () => {
    const { element, called } = shown({ memberIds: [BEN, DEE], askerId: DEE })
    expect(() => getByRole(element, 'button', { name: 'Remove Dee' })).toThrow()
    getByRole(element, 'button', { name: strings.debateSuggestion.open }).click()
    expect(called('acceptSuggestion')[0]!.args[1]).toEqual({
      question: suggestion().question,
      memberIds: [BEN],
    })
  })
})
