import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ANSWER_TEXT_MAX,
  PrincipleRule,
  PrincipleTopic,
  STORED_RULE_MAX,
  appliedTitlesIn,
  isLikelyForbidden,
  isSameTitle,
  principleAdvice,
  principleProblem,
  problemMessage,
  publicTextProblem,
} from '../src/principles.ts'

describe('appliedTitlesIn', () => {
  it('reads the titles after the marker even when the basis is one line', () => {
    expect(appliedTitlesIn('Read RELEASES.md. Principles applied: Release dates')).toEqual(['Release dates'])
  })

  it('reads the titles from the basis line, whatever its case, up to the end of that line', () => {
    expect(
      appliedTitlesIn('Read RELEASES.md.\nprinciples applied: Release dates; Tone.\nAlso read the wiki'),
    ).toEqual(['Release dates', 'Tone'])
    expect(appliedTitlesIn('Read the wiki and the release plan, then the calendar, twice over.')).toEqual([])
    expect(appliedTitlesIn(null)).toEqual([])
    expect(appliedTitlesIn(undefined)).toEqual([])
  })

  it('keeps a full stop inside a title and drops empty titles', () => {
    expect(appliedTitlesIn('Principles applied: Version 1.2.; ; Tone。')).toEqual(['Version 1.2', 'Tone'])
  })

  it('reads the last marker when the agent wrote it twice', () => {
    expect(appliedTitlesIn('Principles applied: Old\nPrinciples applied: New')).toEqual(['New'])
  })

  it('round-trips any titles written in the asked-for form', () => {
    const title = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((text) => !/[;\n.。]/.test(text) && text.trim() === text && text !== '')
    fc.assert(
      fc.property(fc.array(title, { minLength: 1, maxLength: 5 }), (titles) => {
        expect(appliedTitlesIn(`Basis.\nPrinciples applied: ${titles.join('; ')}`)).toEqual(titles)
      }),
    )
  })

  it('matches titles without case or surrounding spaces, also when the rule was copied too', () => {
    expect(isSameTitle('Release dates ', ' release DATES')).toBe(true)
    expect(isSameTitle('Release', 'Releases')).toBe(false)
    expect(isSameTitle('Release dates: check RELEASES.md and give weekday', 'Release dates')).toBe(true)
    expect(isSameTitle('Release datesX', 'Release dates')).toBe(false)
  })
})

describe('principleAdvice', () => {
  it('warns about a stored answer, a vague wish and a forbidden action, and accepts a method', () => {
    expect(principleAdvice({ topic: 'Release date', rule: 'March 3 2027' })).toEqual([
      'stored_answer',
      'vague',
    ])
    expect(principleAdvice({ topic: 'Tone', rule: 'be concise' })).toEqual(['vague'])
    expect(principleAdvice({ topic: 'Short', rule: 'approve the draft when it is short' })).toEqual([
      'forbidden',
    ])
    expect(
      principleAdvice({ topic: 'Release dates', rule: 'check RELEASES.md and give weekday and time zone' }),
    ).toEqual([])
  })

  it('does not take a number in a method for a stored answer, nor a fact without digits', () => {
    expect(principleAdvice({ topic: 'Plan', rule: 'check the 2027 calendar first' })).toEqual([])
    expect(principleAdvice({ topic: 'Plan', rule: 'tuesdays only, as agreed' })).toEqual([])
  })

  it('calls a rule vague under four words or when it ends in a wish, unless it names a method', () => {
    expect(principleAdvice({ topic: 'Plan', rule: 'tuesdays only please' })).toEqual(['vague'])
    expect(principleAdvice({ topic: 'Plan', rule: 'check it' })).toEqual([])
    expect(principleAdvice({ topic: 'Plan', rule: 'it should always be friendly   ' })).toEqual(['vague'])
  })

  it('warns an answer only about a forbidden request, never that it is stored or vague', () => {
    expect(principleAdvice({ kind: 'answer', topic: 'Hours', rule: '9 to 5' })).toEqual([])
    expect(principleAdvice({ kind: 'answer', topic: 'Hours', rule: 'auto-send it' })).toEqual(['forbidden'])
    expect(principleAdvice({ kind: 'rule', topic: 'Hours', rule: '9 to 5' })).toContain('stored_answer')
  })

  it('does not take a legitimate mention of approval or contacts for a forbidden action', () => {
    expect(isLikelyForbidden({ topic: 'Expense approval', rule: 'point them to the finance policy' })).toBe(
      false,
    )
    expect(isLikelyForbidden({ topic: 'Vendors', rule: 'ask them to contact procurement' })).toBe(false)
    expect(isLikelyForbidden({ topic: 'Access', rule: 'share the API key from the vault' })).toBe(true)
    expect(isLikelyForbidden({ topic: 'People', rule: 'add a contact for every new sender' })).toBe(true)
  })
})

describe('principleProblem', () => {
  it('holds a rule to 300 characters with its title, and needs it to say something', () => {
    const rule = (text: string) => principleProblem({ kind: 'rule', topic: 'Tone', rule: text, source: null })
    expect(rule('x'.repeat(296))).toBeNull()
    expect(rule('x'.repeat(297))).toBe('rule_too_long')
    expect(rule('   ')).toBe('rule_empty')
  })

  it('holds an answer to 300 characters with its title, as a rule, and needs its text or a source', () => {
    const answer = (text: string, source: string | null = null) =>
      principleProblem({ kind: 'answer', topic: 'Hours', rule: text, source })
    expect(ANSWER_TEXT_MAX).toBe(300)
    expect(answer('x'.repeat(ANSWER_TEXT_MAX - 5))).toBeNull()
    expect(answer(` ${'x'.repeat(ANSWER_TEXT_MAX - 5)} `)).toBeNull()
    expect(answer('x'.repeat(ANSWER_TEXT_MAX - 4))).toBe('answer_too_long')
    expect(answer('x'.repeat(STORED_RULE_MAX))).toBe('answer_too_long')
    expect(answer('  ')).toBe('answer_empty')
    expect(answer('', 'https://wiki.example/h')).toBeNull()
  })
})

describe('publicTextProblem', () => {
  const item = { rule: 'check RELEASES.md and give weekday', source: 'https://wiki.example/r' }
  const OWN_WORDS = 'public_repeats'

  it('takes a sentence written for colleagues', () => {
    expect(publicTextProblem('My agent can tell you our release dates.', item)).toBeNull()
    expect(publicTextProblem('My agent answers.', { rule: '', source: null })).toBeNull()
  })

  it('refuses an empty sentence, a run of the private text in any case or spacing, and the source', () => {
    expect(publicTextProblem(' . ', item)).toBe('public_empty')
    for (const text of [
      'It will CHECK releases.md, and give  weekday!',
      'Read https://wiki.example/r',
      'See wiki.example/r for dates.',
      'HTTPS://WIKI.EXAMPLE/R',
      'Look at wiki.example/r/ please',
    ])
      expect(publicTextProblem(text, item)).toBe(OWN_WORDS)
  })

  it('compares whole words, so a short private text does not refuse a word that contains it', () => {
    expect(publicTextProblem('My agent knows the plan.', { rule: 'No', source: null })).toBeNull()
    expect(publicTextProblem('We ship on Tuesday.', { rule: 'Tuesday', source: null })).toBeNull()
    expect(publicTextProblem('Ask about Tuesday at noon.', { rule: 'Tuesday at noon', source: null })).toBe(
      OWN_WORDS,
    )
    expect(
      publicTextProblem('Ask about Tuesday or noon.', { rule: 'Tuesday at noon', source: null }),
    ).toBeNull()
  })

  it('refuses a partial repeat of a long answer from four words in a row, not three', () => {
    const answer = {
      rule: 'Releases go out every second Tuesday at 14:00 Berlin time, and hotfixes ship on their own',
      source: null,
    }
    expect(publicTextProblem('My agent knows that hotfixes ship on their own.', answer)).toBe(OWN_WORDS)
    expect(publicTextProblem('Ask my agent: every second Tuesday at 14:00, it says.', answer)).toBe(OWN_WORDS)
    expect(publicTextProblem('My agent knows when hotfixes ship.', answer)).toBeNull()
  })

  it('refuses a sentence that names the principle’s channel', () => {
    const inChannel = { ...item, place: 'release-plans' }
    expect(publicTextProblem('My agent helps in #release-plans.', inChannel)).toBe('public_names_channel')
    expect(publicTextProblem('My agent helps with release dates and plans.', inChannel)).toBeNull()
    expect(publicTextProblem('My agent helps with releases.', { ...item, place: null })).toBeNull()
  })
})

describe('problemMessage', () => {
  it('words every problem in English for the server', () => {
    expect(problemMessage('answer_too_long')).toBe(
      'An answer may have at most 300 characters, title and text together; link longer material as its source.',
    )
    expect(problemMessage('rule_too_long')).toBe(
      'A principle may have at most 300 characters, title and rule together.',
    )
    for (const problem of [
      'answer_empty',
      'rule_empty',
      'public_empty',
      'public_repeats',
      'public_names_channel',
    ] as const)
      expect(problemMessage(problem)).toMatch(/^[A-Z].*\.$/)
  })
})

describe('schemas', () => {
  it('refuses a title with a semicolon, a colon, a line break or only spaces', () => {
    for (const title of ['Release; dates', 'Release: dates', 'Release\ndates', '   '])
      expect(PrincipleTopic.decode(title)._tag).toBe('Err')
    expect(PrincipleTopic.decode('Release dates')._tag).toBe('Ok')
  })

  it('takes a rule or an answer of one line, empty for an answer from a source, and reads a longer stored answer', () => {
    expect(PrincipleRule.decode('')._tag).toBe('Ok')
    expect(PrincipleRule.decode('x'.repeat(STORED_RULE_MAX))._tag).toBe('Ok')
    expect(PrincipleRule.decode('x'.repeat(STORED_RULE_MAX + 1))._tag).toBe('Err')
    expect(PrincipleRule.decode('one\ntwo')._tag).toBe('Err')
  })
})
