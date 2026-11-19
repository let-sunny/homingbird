import { Conflict, Forbidden, NotFound, RateLimited, Unauthorized, Unavailable } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { CliFailure, EXIT, SIGNED_OUT_MESSAGE, failed, fromApiError } from '../src/failure.ts'

describe('failures', () => {
  it('gives every kind of failure its own exit code, none of them success', () => {
    const codes = Object.values(EXIT)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).not.toContain(0)
  })

  it('makes a plain failure exit with the failed code', () => {
    expect(failed('The file could not be written.')).toEqual(
      CliFailure({ message: 'The file could not be written.', exitCode: EXIT.failed }),
    )
  })

  it('turns a refused credential into the signed-out failure that says how to sign in', () => {
    expect(fromApiError(Unauthorized({ message: 'token revoked' }))).toEqual(
      CliFailure({ message: SIGNED_OUT_MESSAGE, exitCode: EXIT.signedOut }),
    )
    expect(SIGNED_OUT_MESSAGE).toContain('homingbird login --server')
  })

  it('keeps the server’s own words for every other refusal', () => {
    for (const error of [
      Forbidden({ message: 'Agents cannot do that.' }),
      NotFound({ message: 'No such note.' }),
      Conflict({ message: 'Already sent.' }),
      RateLimited({ message: 'Slow down.' }),
      Unavailable({ message: 'Upgrade the server.' }),
    ])
      expect(fromApiError(error)).toEqual(CliFailure({ message: error.message, exitCode: EXIT.failed }))
  })
})
