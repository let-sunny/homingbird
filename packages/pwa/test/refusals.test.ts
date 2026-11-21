import type { ApiError } from '@homingbird/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { refusalText } from '../src/refusals.ts'
import { strings, useLanguage } from '../src/strings.ts'

const conflict = (message: string): ApiError => ({ _tag: 'Conflict', message })

describe('refusalText', () => {
  afterEach(() => useLanguage('en'))

  it('says a draft was handled only when the attempt was about a draft', () => {
    expect(refusalText(conflict('This draft was already sent or discarded.'), 'draft')).toBe(
      strings.refusals.draftHandled,
    )
  })

  it('says an agent changed the draft after the person read it, rather than that it was handled', () => {
    const changed = conflict('This draft changed; read it again.')
    expect(refusalText(changed, 'draft')).toBe(strings.refusals.draftChanged)
    expect(refusalText(changed, 'request')).toBe(strings.refusals.requestNotWaiting)
    useLanguage('ko')
    expect(refusalText(changed, 'draft')).toBe(strings.refusals.draftChanged)
  })

  it('says a connection code is unknown or expired, whatever the server calls it', () => {
    for (const error of [
      { _tag: 'NotFound', message: 'Unknown user code.' },
      { _tag: 'Conflict', message: 'This code expired.' },
      { _tag: 'Invalid', message: 'Bad code.' },
    ] as const)
      expect(refusalText(error, 'device')).toBe(strings.refusals.connectionCode)
  })

  it('leaves other refusals on the device page to their general sentence', () => {
    expect(refusalText({ _tag: 'RateLimited', message: 'Slow down.' }, 'device')).not.toBe(
      strings.refusals.connectionCode,
    )
  })

  it('shows the server’s own words for a conflict the client cannot name', () => {
    const message = 'People leave an open channel by themselves.'
    expect(refusalText(conflict(message))).toBe(message)
    expect(refusalText(conflict(message), 'move')).toBe(message)
  })

  it('names the case the client knows, in the reader’s language', () => {
    useLanguage('ko')
    expect(refusalText(conflict('Make another member a manager first.'), 'managers')).toBe(
      strings.refusals.lastManager,
    )
    expect(refusalText(conflict('That name is not available.'), 'channel-name')).toBe(
      strings.refusals.nameTaken,
    )
    expect(refusalText(conflict('x'), 'request')).toBe(strings.refusals.requestNotWaiting)
  })

  it('recognises an archived room whatever was attempted', () => {
    const archived = conflict(
      'No reply is possible: this channel was archived. It can still be read, but nothing more can be written in it, here or in the web client.',
    )
    expect(refusalText(archived, 'draft')).toBe(strings.refusals.roomArchived)
    expect(refusalText(archived)).toBe(strings.refusals.roomArchived)
  })

  it('keeps other kinds of refusal to their general sentence or the server’s words', () => {
    expect(refusalText({ _tag: 'Forbidden', message: 'Only a manager can do that.' }, 'draft')).toBe(
      'Only a manager can do that.',
    )
    useLanguage('ko')
    expect(refusalText({ _tag: 'RateLimited', message: 'Slow down.' })).toBe(strings.errors.RateLimited)
  })
})
