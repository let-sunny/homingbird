import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  editDifference,
  isSubstantialEdit,
  isUnchangedSuggestion,
  suggestedChange,
} from '../src/edit-difference.ts'

const sentence = fc
  .array(
    fc.constantFrom('the', 'release', 'ships', 'on', 'Tuesday', 'at', '14:00', 'CET', 'soon', 'next', 'week'),
    {
      minLength: 1,
      maxLength: 30,
    },
  )
  .map((words) => words.join(' '))

describe('editDifference', () => {
  it('finds no change between a text and itself, or one that differs only in spacing, case and punctuation', () => {
    fc.assert(
      fc.property(sentence, (text) => {
        expect(editDifference(text, text).changedWords).toBe(0)
        expect(editDifference(text, `  ${text.toUpperCase().replaceAll(' ', ' ,  ')}!`).changedWords).toBe(0)
      }),
    )
  })

  it('names the phrases removed and added', () => {
    const difference = editDifference('The release ships soon.', 'The release ships on Tuesday at 14:00 CET.')
    expect(difference.removed).toEqual(['soon'])
    expect(difference.added).toEqual(['on Tuesday at 14:00 CET'])
    expect(difference.changedWords).toBe(5)
  })

  it('does not count a corrected typo as a change', () => {
    expect(
      editDifference('Thanks for the reminder about the invoise', 'Thanks for the reminder about the invoice')
        .changedWords,
    ).toBe(0)
  })

  it('never counts more changed words than the longer text has', () => {
    fc.assert(
      fc.property(sentence, sentence, (a, b) => {
        const difference = editDifference(a, b)
        expect(difference.changedWords).toBeGreaterThanOrEqual(0)
        expect(difference.share).toBeLessThanOrEqual(1)
      }),
    )
  })
})

describe('isSubstantialEdit', () => {
  it('ignores a typo, whitespace or punctuation', () => {
    expect(isSubstantialEdit('We ship on Tuesday.', 'We  ship on Tuesday!')).toBe(false)
    expect(isSubstantialEdit('We ship on Tuesdya.', 'We ship on Tuesday.')).toBe(false)
  })

  it('takes eight changed words, or three words that are at least 15% of the text', () => {
    const long =
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone'
    expect(isSubstantialEdit(long, long.replace('three four', 'alpha beta'))).toBe(false)
    expect(isSubstantialEdit(long, long.replace('three four five', 'alpha beta gamma'))).toBe(false)
    expect(isSubstantialEdit('The release ships soon.', 'The release ships on Tuesday at 14:00 CET.')).toBe(
      true,
    )
    expect(isSubstantialEdit(long, `${long} a b c d e f g h`)).toBe(true)
  })
})

describe('suggestedChange', () => {
  it('names what was said instead of what, from the edit alone', () => {
    expect(suggestedChange('The release ships soon.', 'The release ships on Tuesday at 14:00 CET.')).toEqual({
      added: 'on Tuesday at 14:00 CET',
      removed: 'soon',
    })
  })

  it('names only an addition or only a removal', () => {
    expect(
      suggestedChange('Payslips arrive monthly.', 'Payslips arrive monthly, see the payroll calendar.'),
    ).toEqual({ added: 'see the payroll calendar', removed: null })
    expect(suggestedChange('Payslips arrive monthly, probably.', 'Payslips arrive monthly.')).toEqual({
      added: null,
      removed: 'probably',
    })
  })

  it('takes the longest of several short changes', () => {
    const expected = { added: 'the 25th of each month', removed: 'soon' }
    expect(
      suggestedChange('Pay day is soon. Ask HR.', 'Pay day is the 25th of each month. Ask HR today.'),
    ).toEqual(expected)
    expect(
      suggestedChange('Ask HR. Pay day is soon.', 'Ask HR today. Pay day is the 25th of each month.'),
    ).toEqual(expected)
  })

  it('offers nothing when no short sentence can be made', () => {
    expect(suggestedChange('Same text.', 'Same text.')).toBeNull()
    const long = Array.from({ length: 30 }, (_, index) => `word${index}`).join(' ')
    expect(suggestedChange('Short.', long)).toBeNull()
  })
})

describe('isUnchangedSuggestion', () => {
  it('holds while a rule keeps every suggested phrase word for word, in any wording around them', () => {
    const change = { added: 'on Tuesday', removed: 'soon' }
    expect(isUnchangedSuggestion(change, 'say “on Tuesday” instead of “soon”')).toBe(true)
    expect(isUnchangedSuggestion(change, '“soon” 대신 “on Tuesday”라고 말하기')).toBe(true)
    expect(isUnchangedSuggestion(change, 'give the weekday instead of soon')).toBe(false)
    expect(isUnchangedSuggestion({ added: 'the calendar', removed: null }, 'link the calendar')).toBe(true)
    expect(isUnchangedSuggestion({ added: null, removed: 'probably' }, 'never guess')).toBe(false)
  })
})

describe('editDifference against a plain longest common subsequence', () => {
  const lcs = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): number => {
    const table = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0))
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        table[i]![j] =
          a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    return table[0]![0]!
  }
  const shortWords = fc.array(fc.constantFrom('a', 'b', 'c', 'ab', 'ba', 'cab'), { maxLength: 15 })

  it('counts every word outside the common part, removed and added, never a typo among short words', () => {
    fc.assert(
      fc.property(shortWords, shortWords, (before, after) => {
        const common = lcs(before, after)
        const difference = editDifference(before.join(' '), after.join(' '))
        const removed = difference.removed.flatMap((phrase) => phrase.split(' '))
        const added = difference.added.flatMap((phrase) => phrase.split(' '))
        expect(removed).toHaveLength(before.length - common)
        expect(added).toHaveLength(after.length - common)
        expect(difference.changedWords).toBe(Math.max(removed.length, added.length))
        expect(difference.share).toBe(difference.changedWords / Math.max(1, before.length, after.length))
      }),
    )
  })

  it('keeps several removed words together as one phrase, and strips punctuation around a word but not a percent', () => {
    const difference = editDifference('We ship it maybe next week, ok', 'We ship ((it)) 15%!! ok')
    expect(difference.removed).toEqual(['maybe next week'])
    expect(difference.added).toEqual(['15%'])
  })
})

describe('typos', () => {
  const changed = (a: string, b: string) =>
    editDifference(`Hello ${a} there`, `Hello ${b} there`).changedWords

  it('forgives one letter in a word of four to six letters, two from seven, and none below four', () => {
    expect(changed('abcd', 'abce')).toBe(0)
    expect(changed('abc', 'abd')).toBe(1)
    expect(changed('abc', 'abcd')).toBe(1)
    expect(changed('abcdef', 'abcdex')).toBe(0)
    expect(changed('abcdef', 'abcdxy')).toBe(1)
    expect(changed('abcdefg', 'abcdexy')).toBe(0)
    expect(changed('abcdefg', 'abcdxyz')).toBe(1)
    expect(changed('abcdef', 'abcdefgh')).toBe(0)
    expect(changed('abcdefgh', 'abcdefghijk')).toBe(1)
  })

  it('measures the distance by insertions, deletions and substitutions alike', () => {
    expect(changed('release', 'relase')).toBe(0)
    expect(changed('relase', 'release')).toBe(0)
    expect(changed('release', 'reelase')).toBe(0)
    expect(changed('release', 'xxlease')).toBe(0)
    expect(changed('release', 'xxxease')).toBe(1)
    expect(changed('kitten', 'sitting')).toBe(1)
  })
})

describe('isSubstantialEdit at its bounds', () => {
  const words = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(' ')

  it('takes exactly eight changed words in a long text, not seven', () => {
    const base = words(80, 'w')
    expect(isSubstantialEdit(base, `${base} ${words(8, 'q')}`)).toBe(true)
    expect(isSubstantialEdit(base, `${base} ${words(7, 'q')}`)).toBe(false)
  })

  it('takes three changed words at exactly 15%, not two, and not three under 15%', () => {
    expect(isSubstantialEdit(words(17, 'w'), `${words(17, 'w')} ${words(3, 'q')}`)).toBe(true)
    expect(isSubstantialEdit(words(18, 'w'), `${words(18, 'w')} ${words(3, 'q')}`)).toBe(false)
    expect(isSubstantialEdit(words(3, 'w'), `${words(3, 'w')} ${words(2, 'q')}`)).toBe(false)
  })
})

describe('suggestedChange at its bounds', () => {
  it('offers nothing when the removed part is too long to name, even when the added part is short', () => {
    const long = Array.from({ length: 12 }, (_, index) => `old${index}`).join(' ')
    expect(suggestedChange(`Start ${long} end.`, 'Start new end.')).toBeNull()
  })

  it('takes a phrase of ten words, not eleven', () => {
    const ten = Array.from({ length: 10 }, (_, index) => `new${index}`).join(' ')
    expect(suggestedChange('Start end.', `Start ${ten} end.`)).toEqual({ added: ten, removed: null })
    expect(suggestedChange('Start end.', `Start ${ten} more end.`)).toBeNull()
  })

  it('keeps phrases of 280 characters together, not 281', () => {
    expect(suggestedChange('Start abc.', `Start ${'x'.repeat(277)}.`)).toEqual({
      added: 'x'.repeat(277),
      removed: 'abc',
    })
    expect(suggestedChange('Start abc.', `Start ${'x'.repeat(278)}.`)).toBeNull()
  })

  it('keeps the first of two equally long changes', () => {
    expect(suggestedChange('alpha xy beta yz gamma', 'alpha abc beta bcd gamma')).toEqual({
      added: 'abc',
      removed: 'xy',
    })
  })
})
