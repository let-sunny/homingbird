import { Task as T } from '@homingbird/kernel'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { RPC_CODE, RpcFailure, invalidParams, methodNotFound, serveJsonRpc } from '../src/json-rpc.ts'

const serve = serveJsonRpc((call) => {
  if (call.method === 'echo') return T.succeed(call.params)
  if (call.method === 'refuse')
    return T.fail(RpcFailure({ code: -32001, message: 'no', data: { why: 'because' } }))
  if (call.method === 'plain') return T.fail(invalidParams('bad'))
  if (call.method === 'crash')
    return T.sync(() => {
      throw new Error('secret detail')
    })
  return T.fail(methodNotFound(call.method))
})

const answer = (message: unknown) => T.runPromise(serve(message))

describe('serveJsonRpc', () => {
  it('answers a request with its result and echoes the id', async () => {
    expect(await answer({ jsonrpc: '2.0', id: 7, method: 'echo', params: { a: 1 } })).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { a: 1 },
    })
  })

  it('treats missing params as an empty object', async () => {
    expect(await answer({ jsonrpc: '2.0', id: 'x', method: 'echo' })).toEqual({
      jsonrpc: '2.0',
      id: 'x',
      result: {},
    })
  })

  it('accepts a null id', async () => {
    expect(await answer({ jsonrpc: '2.0', id: null, method: 'echo' })).toMatchObject({ id: null, result: {} })
  })

  it('answers nothing to a notification, even one that fails', async () => {
    expect(await answer({ jsonrpc: '2.0', method: 'echo' })).toBeNull()
    expect(await answer({ jsonrpc: '2.0', method: 'refuse' })).toBeNull()
    expect(await answer({ jsonrpc: '2.0', method: 'crash' })).toBeNull()
  })

  it('reports a failure with its code, message and data', async () => {
    expect(await answer({ jsonrpc: '2.0', id: 1, method: 'refuse' })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32001, message: 'no', data: { why: 'because' } },
    })
  })

  it('omits data when the failure carries none', async () => {
    expect(await answer({ jsonrpc: '2.0', id: 1, method: 'plain' })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: RPC_CODE.invalidParams, message: 'bad' },
    })
  })

  it('reports an unknown method as method not found', async () => {
    expect(await answer({ jsonrpc: '2.0', id: 1, method: 'nope' })).toMatchObject({
      error: { code: RPC_CODE.methodNotFound, message: 'Method not found: nope' },
    })
  })

  it('hides the details of a defect behind an internal error', async () => {
    const reply = await answer({ jsonrpc: '2.0', id: 1, method: 'crash' })
    expect(reply).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: RPC_CODE.internalError, message: 'Internal error' },
    })
  })

  it.each([
    ['a non-object', 42],
    ['null', null],
    ['a string', 'ping'],
    ['a wrong version', { jsonrpc: '1.0', id: 1, method: 'echo' }],
    ['a missing version', { id: 1, method: 'echo' }],
    ['a missing method', { jsonrpc: '2.0', id: 1 }],
    ['a non-string method', { jsonrpc: '2.0', id: 1, method: 5 }],
    ['array params', { jsonrpc: '2.0', id: 1, method: 'echo', params: [1] }],
    ['scalar params', { jsonrpc: '2.0', id: 1, method: 'echo', params: 'x' }],
  ])('rejects %s as an invalid request', async (_, message) => {
    expect(await answer(message)).toMatchObject({ error: { code: RPC_CODE.invalidRequest } })
  })

  it('echoes the id of an invalid request when it has a usable one, and null otherwise', async () => {
    expect(await answer({ jsonrpc: '1.0', id: 9, method: 'echo' })).toMatchObject({ id: 9 })
    expect(await answer({ jsonrpc: '2.0', id: { nested: true }, method: 'echo' })).toMatchObject({
      id: null,
      error: { code: RPC_CODE.invalidRequest },
    })
  })

  it('ignores responses posted by the peer', async () => {
    expect(await answer({ jsonrpc: '2.0', id: 1, result: {} })).toBeNull()
    expect(await answer({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'x' } })).toBeNull()
  })

  it('answers a batch in order, leaving out notifications', async () => {
    expect(
      await answer([
        { jsonrpc: '2.0', id: 1, method: 'echo', params: { n: 1 } },
        { jsonrpc: '2.0', method: 'echo' },
        { jsonrpc: '2.0', id: 2, method: 'nope' },
      ]),
    ).toMatchObject([
      { id: 1, result: { n: 1 } },
      { id: 2, error: { code: RPC_CODE.methodNotFound } },
    ])
  })

  it('answers nothing to a batch of notifications', async () => {
    expect(await answer([{ jsonrpc: '2.0', method: 'echo' }])).toBeNull()
  })

  it('rejects an empty batch', async () => {
    expect(await answer([])).toMatchObject({ id: null, error: { code: RPC_CODE.invalidRequest } })
  })

  it('always answers a request that has an id with that id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.string(), fc.integer()),
        fc.string(),
        fc.dictionary(fc.string(), fc.jsonValue()),
        async (id, method, params) => {
          const reply = (await answer({ jsonrpc: '2.0', id, method, params })) as {
            id: unknown
            jsonrpc: string
          }
          expect(reply.jsonrpc).toBe('2.0')
          expect(reply.id).toBe(id)
          expect('result' in reply !== 'error' in reply).toBe(true)
        },
      ),
    )
  })

  it('never answers a notification', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (method) => {
        expect(await answer({ jsonrpc: '2.0', method })).toBeNull()
      }),
    )
  })
})
