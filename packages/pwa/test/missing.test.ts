import { Task as T } from '@homingbird/kernel'
import type { ApiError } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { MISSING, orMissing } from '../src/missing.ts'

const refused = (error: ApiError) => T.fail(error) as T.Task<string, ApiError>

describe('orMissing', () => {
  it('passes a found value through', async () => {
    expect(await T.runPromise(orMissing(T.succeed('thread') as T.Task<string, ApiError>))).toBe('thread')
  })

  it('turns a NotFound refusal into a missing page instead of an error', async () => {
    expect(
      await T.runPromise(orMissing(refused({ _tag: 'NotFound', message: 'No such conversation.' }))),
    ).toBe(MISSING)
  })

  it('keeps every other refusal an error', async () => {
    const exit = await T.run(orMissing(refused({ _tag: 'Forbidden', message: 'No.' })), {})
    expect(exit._tag).toBe('Err')
  })
})
