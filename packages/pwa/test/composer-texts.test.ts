import { describe, expect, it } from 'vitest'
import {
  forgetComposerTexts,
  keepComposerTexts,
  keptComposerTexts,
  withComposerText,
} from '../src/composer-texts.ts'
import { fakePage } from './support/context.ts'
import { ANA, BEN, ROOM } from './support/fixtures.ts'

const OTHER = 'conv_other0000000' as typeof ROOM

describe('composer texts', () => {
  it('keeps each person’s unsent texts apart, and reads back what it kept', () => {
    const { page, local } = fakePage()
    keepComposerTexts(page.storage, ANA, new Map([[ROOM, 'Half a thought']]))
    expect(keptComposerTexts(page.storage, ANA)).toEqual(new Map([[ROOM, 'Half a thought']]))
    expect(keptComposerTexts(page.storage, BEN)).toEqual(new Map())
    keepComposerTexts(page.storage, ANA, new Map())
    expect(local.size).toBe(0)
    keepComposerTexts(page.storage, ANA, new Map([[ROOM, 'Again']]))
    forgetComposerTexts(page.storage, ANA)
    expect(keptComposerTexts(page.storage, ANA)).toEqual(new Map())
  })

  it('reads nothing from what it cannot read, and skips blank or odd entries', () => {
    const { page, local } = fakePage()
    const key = `homingbird.composer.${ANA}`
    for (const stored of ['{', '[]', 'null', '"text"']) {
      local.set(key, stored)
      expect(keptComposerTexts(page.storage, ANA)).toEqual(new Map())
    }
    local.set(key, JSON.stringify({ [ROOM]: 'Kept', [OTHER]: '  ', third: 7 }))
    expect(keptComposerTexts(page.storage, ANA)).toEqual(new Map([[ROOM, 'Kept']]))
  })

  it('sets a conversation’s text, and removes it when only spaces are left', () => {
    const one = withComposerText(new Map(), ROOM, 'Hi')
    expect(one).toEqual(new Map([[ROOM, 'Hi']]))
    expect(withComposerText(one, OTHER, 'There')).toEqual(
      new Map([
        [ROOM, 'Hi'],
        [OTHER, 'There'],
      ]),
    )
    expect(withComposerText(one, ROOM, ' \n ')).toEqual(new Map())
  })
})
