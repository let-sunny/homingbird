import {
  Conflict,
  Forbidden,
  Invalid,
  NotFound,
  RateLimited,
  Unauthorized,
  Unavailable,
} from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { A2A_CODE, rpcFailureOf } from '../src/errors.ts'
import { RPC_CODE, RpcFailure } from '../src/json-rpc.ts'

describe('rpcFailureOf', () => {
  it('passes a JSON-RPC failure through unchanged', () => {
    const failure = RpcFailure({ code: A2A_CODE.taskNotFound, message: 'gone' })
    expect(rpcFailureOf(failure)).toBe(failure)
  })

  it.each([
    [Invalid({ message: 'm' }), RPC_CODE.invalidParams],
    [NotFound({ message: 'm' }), RPC_CODE.invalidParams],
    [Conflict({ message: 'm' }), RPC_CODE.invalidRequest],
    [Forbidden({ message: 'm' }), RPC_CODE.invalidRequest],
    [Unauthorized({ message: 'm' }), RPC_CODE.invalidRequest],
    [RateLimited({ message: 'm' }), RPC_CODE.invalidRequest],
    [Unavailable({ message: 'm' }), RPC_CODE.internalError],
  ])('maps %j to JSON-RPC code %i and keeps the message', (error, code) => {
    expect(rpcFailureOf(error)).toEqual(RpcFailure({ code, message: 'm' }))
  })

  it('uses the A2A error codes of the specification', () => {
    expect(A2A_CODE).toEqual({
      taskNotFound: -32001,
      taskNotCancelable: -32002,
      pushNotificationNotSupported: -32003,
      unsupportedOperation: -32004,
      contentTypeNotSupported: -32005,
    })
  })
})
