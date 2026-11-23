import { presetById } from '@homingbird/sprites'
import { lifetime } from '@homingbird/ui'
import { allByRole, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { characterPreview, myCharacterSection } from '../../src/views/character.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { me } from '../support/fixtures.ts'

usingFakeDom()

describe('myCharacterSection', () => {
  it('picks a built-in character, previews it, and uses it', () => {
    const { context, called } = testContext()
    const shown = myCharacterSection(context, lifetime(), me())
    expect(queryByRole(shown, 'button', { name: strings.character.backToDefault })).toBeNull()
    const owl = getByRole(shown, 'button', { name: /Owl/ })
    owl.click()
    expect(owl.getAttribute('aria-pressed')).toBe('true')
    expect(getByRole(shown, 'status').textContent).toBe(strings.character.selected({ character: 'Owl' }))
    expect(getByRole(shown, 'link', { name: strings.character.editThis }).getAttribute('href')).toBe(
      '#/character?from=owl',
    )
    getByRole(shown, 'button', { name: strings.character.use }).click()
    expect(called('useCharacter')[0]!.args).toEqual([presetById('owl')])
    called('useCharacter')[0]!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.character.saved })
  })

  it('goes back to the default, and cannot use the character already in use', () => {
    const { context, called } = testContext()
    const shown = myCharacterSection(context, lifetime(), me({}, { character: presetById('owl')! }))
    getByRole(shown, 'button', { name: strings.character.backToDefault }).click()
    expect(called('useCharacter')[0]!.args).toEqual([null])
    getByRole(shown, 'button', { name: /Owl/ }).click()
    expect((getByRole(shown, 'button', { name: strings.character.use }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})

describe('characterPreview', () => {
  it('names each state it shows', () => {
    const { context } = testContext()
    const shown = characterPreview(context, presetById('owl')!)
    expect(allByRole(shown, 'img', { name: `Owl: ${strings.character.states.idle}` })).toHaveLength(2)
    expect(textOf(shown)).toContain(strings.character.onDark)
  })
})
