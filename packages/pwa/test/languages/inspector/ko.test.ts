import { describe, expect, it } from 'vitest'
import { en } from '../../../src/languages/inspector/en.ts'
import { ko } from '../../../src/languages/inspector/ko.ts'
import { placeholdersOf } from '../../../src/messages.ts'

type Entry = string | { readonly [key: string]: Entry }

const texts = (entry: Entry, path = ''): Array<readonly [string, string]> =>
  typeof entry === 'string'
    ? [[path, entry]]
    : Object.entries(entry).flatMap(([key, inner]) => texts(inner, `${path}.${key}`))

describe('the inspector in Korean', () => {
  it('has a text with the same placeholders for each English one, but for the plural forms Korean lacks', () => {
    const english = texts(en).filter(([path]) => !path.endsWith('.one'))
    const korean = new Map(texts(ko as Entry))
    expect([...korean.keys()]).toEqual(english.map(([path]) => path))
    for (const [path, text] of english) {
      expect(placeholdersOf(korean.get(path)!), path).toEqual(placeholdersOf(text))
      expect(korean.get(path), path).not.toBe('')
    }
  })
})
