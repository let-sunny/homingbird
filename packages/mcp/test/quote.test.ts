import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { quotingFor } from '../src/quote.ts'
import { ANA, BEN, DIRECTORY, sequentialNonce } from './support.ts'

describe('quotingFor', () => {
  it('names every member of the directory and keeps the nonce source', async () => {
    const nonce = sequentialNonce()
    const exit = await T.run(quotingFor({ 'directory.list': () => T.succeed(DIRECTORY) } as never, nonce))
    expect(exit).toMatchObject({ _tag: 'Ok' })
    const quoting = (exit as { value: { authors: ReadonlyMap<string, unknown>; nonce: () => string } }).value
    expect(quoting.authors.get(ANA.id)).toEqual(ANA)
    expect(quoting.authors.get(BEN.id)).toEqual(BEN)
    expect(quoting.nonce).toBe(nonce)
  })
})
