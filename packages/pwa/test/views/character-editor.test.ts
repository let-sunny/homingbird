import { SLOTS } from '@homingbird/sprites'
import { lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { characterEditorView } from '../../src/views/character-editor.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { me } from '../support/fixtures.ts'

usingFakeDom()

const control = (shown: HTMLElement, name: string) =>
  shown.querySelector<HTMLInputElement>(`[name="${name}"]`)!

describe('characterEditorView', () => {
  it('starts from the person’s character, changes it, and uses it, then returns to the profile', () => {
    const { context, called, page } = testContext()
    const shown = characterEditorView(context, lifetime(), me(), null, null)
    expect(queryByRole(shown, 'note')).toBeNull()
    fire.type(control(shown, 'character-name'), 'Hoot')
    expect(control(shown, 'character-name').value).toBe('Hoot')
    fire.type(control(shown, 'color-B'), '#123456')
    fire.type(control(shown, 'color-marking'), '#654321')
    control(shown, 'eye-auto').click()
    fire.type(control(shown, 'color-K'), '#000000')
    control(shown, 'feet').click()
    const slot = SLOTS[0]!
    const option = shown.querySelectorAll<HTMLInputElement>(`[name="part-${slot.id}"]`)[1]!
    option.click()
    expect(option.checked).toBe(true)
    getByRole(shown, 'button', { name: strings.character.surprise }).click()
    getByRole(shown, 'button', { name: strings.character.startOver }).click()
    expect(control(shown, 'character-name').value).not.toBe('Hoot')
    getByRole(shown, 'button', { name: strings.character.use }).click()
    called('useCharacter')[0]!.then!.done!(undefined)
    expect(page.visited).toEqual(['go #/me'])
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.character.saved })
  })

  it('opens a built-in as a layer that can be kept or dropped', () => {
    const { context } = testContext()
    const shown = characterEditorView(context, lifetime(), me(), null, 'owl')
    const keep = control(shown, 'keep-layer')
    expect((shown.querySelector('.character-layer') as HTMLElement).hidden).toBe(false)
    keep.click()
    expect(keep.checked).toBe(false)
    keep.click()
    expect(keep.checked).toBe(true)
  })

  it('says when an agent’s link could not be read, and shows an agent’s draft as such', () => {
    const { context } = testContext()
    characterEditorView(context, lifetime(), me(), 'not-a-link', null)
    expect(context.state.notice.get()).toEqual({ kind: 'error', text: strings.character.badLink })
    const plain = characterEditorView(context, lifetime(), me(), null, null)
    const keep = control(plain, 'keep-layer')
    keep.click()
    expect((plain.querySelector('.character-layer') as HTMLElement).hidden).toBe(true)
  })
})
