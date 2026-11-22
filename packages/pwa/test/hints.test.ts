import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  HINTS_RETIRE_AFTER_MS,
  HINT_CONCEPTS,
  type HintConcept,
  hintsAfterDismiss,
  hintsAfterUse,
  isHintRetired,
  isInlineHintDue,
  readHints,
  restartedHints,
  writeHints,
} from '../src/hints.ts'
import { fakePage } from './support/context.ts'

const NOW = Date.UTC(2026, 10, 19, 12)
const concept = fc.constantFrom(...HINT_CONCEPTS)

describe('hints', () => {
  it('shows every hint to someone new, and retires them all after two weeks', () => {
    const record = restartedHints(NOW)
    for (const each of HINT_CONCEPTS) {
      expect(isHintRetired(record, each, NOW + HINTS_RETIRE_AFTER_MS - 1)).toBe(false)
      expect(isHintRetired(record, each, NOW + HINTS_RETIRE_AFTER_MS)).toBe(true)
    }
  })

  it('retires a hint once its control is used, leaving the others', () => {
    fc.assert(
      fc.property(concept, concept, (used, other) => {
        const record = hintsAfterUse(hintsAfterUse(restartedHints(NOW), used), used)
        expect(record.used).toEqual([used])
        expect(isHintRetired(record, used, NOW)).toBe(true)
        expect(isInlineHintDue(record, used, NOW)).toBe(false)
        expect(isHintRetired(record, other, NOW)).toBe(other === used)
      }),
    )
  })

  it('shows a touch screen’s inline hint until it is closed, while the hover hint stays', () => {
    fc.assert(
      fc.property(concept, (closed) => {
        const record = hintsAfterDismiss(hintsAfterDismiss(restartedHints(NOW), closed), closed)
        expect(record.dismissed).toEqual([closed])
        expect(isInlineHintDue(record, closed, NOW)).toBe(false)
        expect(isHintRetired(record, closed, NOW)).toBe(false)
        expect(isInlineHintDue(restartedHints(NOW), closed, NOW + HINTS_RETIRE_AFTER_MS)).toBe(false)
      }),
    )
  })

  it('keeps each person’s record in this browser, starting it on first read', () => {
    const page = fakePage()
    const started = readHints(page.page.storage, 'mem_ana', NOW)
    expect(started).toEqual(restartedHints(NOW))
    expect(page.local.has('homingbird.hints.mem_ana')).toBe(true)
    writeHints(page.page.storage, 'mem_ana', hintsAfterUse(started, 'draft'))
    expect(readHints(page.page.storage, 'mem_ana', NOW + 1)).toEqual({
      since: NOW,
      used: ['draft'],
      dismissed: [],
    })
    expect(readHints(page.page.storage, 'mem_ben', NOW + 1)).toEqual(restartedHints(NOW + 1))
  })

  it('round-trips any record through storage', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: NOW }),
        fc.uniqueArray(concept),
        fc.uniqueArray(concept),
        (since, used, dismissed) => {
          const page = fakePage()
          const sorted = (concepts: HintConcept[]) => HINT_CONCEPTS.filter((each) => concepts.includes(each))
          const record = { since, used: sorted(used), dismissed: sorted(dismissed) }
          writeHints(page.page.storage, 'mem_ana', record)
          expect(readHints(page.page.storage, 'mem_ana', NOW)).toEqual(record)
        },
      ),
    )
  })

  it('starts afresh from a record it cannot read, and reads unknown concepts as none', () => {
    const page = fakePage()
    for (const broken of ['{', 'null', '7', '{"since":"x"}']) {
      page.local.set('homingbird.hints.mem_ana', broken)
      expect(readHints(page.page.storage, 'mem_ana', NOW)).toEqual(restartedHints(NOW))
    }
    page.local.set(
      'homingbird.hints.mem_ana',
      JSON.stringify({ since: 1, used: ['draft', 'gone'], dismissed: 3 }),
    )
    expect(readHints(page.page.storage, 'mem_ana', NOW)).toEqual({ since: 1, used: ['draft'], dismissed: [] })
  })

  it('never retires a hint where storage keeps nothing', () => {
    const page = fakePage()
    const blocked = { ...page.page.storage, local: () => null, setLocal: () => {} }
    writeHints(blocked, 'mem_ana', hintsAfterUse(restartedHints(NOW), 'draft'))
    const later = NOW + HINTS_RETIRE_AFTER_MS * 2
    expect(isHintRetired(readHints(blocked, 'mem_ana', later), 'draft', later)).toBe(false)
  })
})
