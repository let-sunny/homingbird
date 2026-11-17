import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type ApiError,
  Conflict,
  ErrorBody,
  Forbidden,
  HTTP_STATUS,
  Invalid,
  NotFound,
  RateLimited,
  Unauthorized,
  Unavailable,
  fromErrorBody,
  fromStatus,
  toErrorBody,
} from '../src/errors.ts'

const constructors = { Unauthorized, Forbidden, NotFound, Invalid, Conflict, RateLimited, Unavailable }
const anyError: fc.Arbitrary<ApiError> = fc
  .tuple(fc.constantFrom(...Object.values(constructors)), fc.string())
  .map(([make, message]) => make({ message }))

describe('api errors', () => {
  it('maps each error to its own HTTP status', () => {
    expect(HTTP_STATUS).toEqual({
      Unauthorized: 401,
      Forbidden: 403,
      NotFound: 404,
      Invalid: 400,
      Conflict: 409,
      RateLimited: 429,
      Unavailable: 503,
    })
    expect(new Set(Object.values(HTTP_STATUS)).size).toBe(Object.keys(constructors).length)
  })

  it('survives the trip through the wire body', () => {
    fc.assert(
      fc.property(anyError, (error) => {
        const body = toErrorBody(error)
        expect(ErrorBody.decode(JSON.parse(JSON.stringify(body)))).toMatchObject({ _tag: 'Ok' })
        expect(fromErrorBody(body)).toEqual({ ...error })
      }),
    )
  })

  it('recovers the error from a bare status', () => {
    for (const [tag, status] of Object.entries(HTTP_STATUS))
      expect(fromStatus(status, 'm')).toEqual({ _tag: tag, message: 'm' })
  })

  it('treats an unknown status as the server being unavailable', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 599 }), (status) => {
        fc.pre(!Object.values(HTTP_STATUS).includes(status))
        expect(fromStatus(status, 'm')).toEqual({ _tag: 'Unavailable', message: 'm' })
      }),
    )
  })

  it('refuses a body with an unknown code', () => {
    expect(ErrorBody.is({ error: { code: 'Teapot', message: 'm' } })).toBe(false)
  })
})
