import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  AUTO_SEND_OFF,
  AUTO_SEND_PLACES_MAX,
  AutoSend,
  RECALL_WINDOW_MS,
  isSavedAnswerText,
  mayRecall,
} from '../src/auto-send.ts'
import type { MemberId } from '../src/ids.ts'

const ANA = 'mem_anaaaaaaaaaa' as MemberId
const BEN = 'mem_benbbbbbbbbb' as MemberId
const SENT_AT = 1_000_000

const note = (over: Partial<Parameters<typeof mayRecall>[0]> = {}) => ({
  authorId: ANA,
  status: 'sent' as const,
  autoSent: true,
  sentAt: SENT_AT,
  ...over,
})

describe('isSavedAnswerText', () => {
  it('accepts the saved answer’s text exactly, with only the whitespace around it ignored', () => {
    expect(isSavedAnswerText('The office opens at nine.', 'The office opens at nine.')).toBe(true)
    expect(isSavedAnswerText('  The office opens at nine.\n', 'The office opens at nine. ')).toBe(true)
  })

  it('refuses a text that differs by one character anywhere, including case and inner spacing', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 60 }).filter((text) => text.trim() !== ''),
        fc.nat(),
        fc.constantFrom('x', '.', ' a', 'É'),
        (answer, at, extra) => {
          const text = answer.trim()
          const position = at % (text.length + 1)
          const changed = `${text.slice(0, position)}${extra}${text.slice(position)}`
          fc.pre(changed.trim() !== text)
          expect(isSavedAnswerText(changed, text)).toBe(false)
          expect(isSavedAnswerText(text, changed)).toBe(false)
        },
      ),
    )
    expect(isSavedAnswerText('The office opens at Nine.', 'The office opens at nine.')).toBe(false)
    expect(isSavedAnswerText('The office  opens at nine.', 'The office opens at nine.')).toBe(false)
  })

  it('never matches an answer without its own text, whatever the draft says', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom('', ' ', '\n\t'), (body, answer) => {
        expect(isSavedAnswerText(body, answer)).toBe(false)
      }),
    )
  })
})

describe('mayRecall', () => {
  it('lets the author recall a note their saved answer sent until five minutes have passed', () => {
    expect(mayRecall(note(), ANA, SENT_AT)).toBe(true)
    expect(mayRecall(note(), ANA, SENT_AT + RECALL_WINDOW_MS - 1)).toBe(true)
    expect(mayRecall(note(), ANA, SENT_AT + RECALL_WINDOW_MS)).toBe(false)
    expect(RECALL_WINDOW_MS).toBe(5 * 60_000)
  })

  it('refuses anyone but the author, a note sent with a click, and a note not sent', () => {
    expect(mayRecall(note(), BEN, SENT_AT)).toBe(false)
    const { autoSent: _, ...clicked } = note()
    expect(mayRecall(clicked, ANA, SENT_AT)).toBe(false)
    expect(mayRecall(note({ autoSent: false }), ANA, SENT_AT)).toBe(false)
    expect(mayRecall(note({ status: 'withdrawn' }), ANA, SENT_AT)).toBe(false)
    expect(mayRecall(note({ status: 'unknown' }), ANA, SENT_AT)).toBe(false)
    expect(mayRecall(note({ sentAt: null }), ANA, SENT_AT)).toBe(false)
  })
})

describe('AutoSend', () => {
  it('round-trips every setting it allows and starts off with nowhere to send', () => {
    fc.assert(
      fc.property(arbitrary(AutoSend), (setting) => {
        expect(AutoSend.decode(JSON.parse(JSON.stringify(setting)))).toEqual({ _tag: 'Ok', value: setting })
      }),
    )
    expect(AUTO_SEND_OFF).toEqual({ enabled: false, places: [] })
  })

  it('refuses more places than the cap and anything but conversation ids', () => {
    const places = Array.from(
      { length: AUTO_SEND_PLACES_MAX + 1 },
      (_, index) => `conv_${String(index).padStart(12, '0')}`,
    )
    expect(AutoSend.decode({ enabled: true, places })._tag).toBe('Err')
    expect(AutoSend.decode({ enabled: true, places: places.slice(0, AUTO_SEND_PLACES_MAX) })._tag).toBe('Ok')
    expect(AutoSend.decode({ enabled: true, places: ['lobby'] })._tag).toBe('Err')
    expect(AutoSend.decode({ enabled: 'yes', places: [] })._tag).toBe('Err')
  })
})
