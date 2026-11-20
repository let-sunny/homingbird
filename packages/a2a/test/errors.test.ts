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
import { CURRENT, LEGACY } from '../src/dialect.ts'
import { A2A_CODE, rpcFailureOf } from '../src/errors.ts'
import { RPC_CODE, RpcFailure } from '../src/json-rpc.ts'

const SPEC_REASONS: ReadonlyArray<readonly [number, string]> = [
  [-32001, 'TASK_NOT_FOUND'],
  [-32002, 'TASK_NOT_CANCELABLE'],
  [-32003, 'PUSH_NOTIFICATION_NOT_SUPPORTED'],
  [-32004, 'UNSUPPORTED_OPERATION'],
  [-32005, 'CONTENT_TYPE_NOT_SUPPORTED'],
  [-32006, 'INVALID_AGENT_RESPONSE'],
  [-32007, 'EXTENDED_AGENT_CARD_NOT_CONFIGURED'],
  [-32008, 'EXTENSION_SUPPORT_REQUIRED'],
  [-32009, 'VERSION_NOT_SUPPORTED'],
]

describe('rpcFailureOf', () => {
  it('passes a JSON-RPC failure through unchanged in the 0.3 dialect', () => {
    const failure = RpcFailure({ code: A2A_CODE.taskNotFound, message: 'gone' })
    expect(rpcFailureOf(LEGACY)(failure)).toBe(failure)
  })

  it.each([
    [Invalid({ message: 'm' }), RPC_CODE.invalidParams],
    [NotFound({ message: 'm' }), RPC_CODE.invalidParams],
    [Conflict({ message: 'm' }), RPC_CODE.invalidRequest],
    [Forbidden({ message: 'm' }), RPC_CODE.invalidRequest],
    [Unauthorized({ message: 'm' }), RPC_CODE.invalidRequest],
    [RateLimited({ message: 'm' }), RPC_CODE.invalidRequest],
    [Unavailable({ message: 'm' }), RPC_CODE.internalError],
  ])('maps %j to JSON-RPC code %i and keeps the message, in either dialect', (error, code) => {
    for (const dialect of [CURRENT, LEGACY])
      expect(rpcFailureOf(dialect)(error)).toEqual(RpcFailure({ code, message: 'm' }))
  })

  it.each(SPEC_REASONS)('adds the A2A 1.0 ErrorInfo to error %i with reason %s', (code, reason) => {
    expect(rpcFailureOf(CURRENT)(RpcFailure({ code, message: 'm' }))).toEqual(
      RpcFailure({
        code,
        message: 'm',
        data: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'a2a-protocol.org' }],
      }),
    )
  })

  it.each(SPEC_REASONS)('leaves error %i without details in the 0.3 dialect', (code) => {
    expect(rpcFailureOf(LEGACY)(RpcFailure({ code, message: 'm' }))).toEqual(
      RpcFailure({ code, message: 'm' }),
    )
  })

  it('uses the A2A error codes of the specification', () => {
    expect(A2A_CODE).toEqual({
      taskNotFound: -32001,
      taskNotCancelable: -32002,
      pushNotificationNotSupported: -32003,
      unsupportedOperation: -32004,
      contentTypeNotSupported: -32005,
      invalidAgentResponse: -32006,
      extendedAgentCardNotConfigured: -32007,
      extensionSupportRequired: -32008,
      versionNotSupported: -32009,
    })
  })
})
