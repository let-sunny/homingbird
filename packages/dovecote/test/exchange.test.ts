import { Conflict } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  type HttpRequest,
  INVALID_JSON,
  apiFailure,
  formFields,
  json,
  noContent,
  parseJson,
  redirect,
  text,
  withHeaders,
} from '../src/http/exchange.ts'

const request = (body: string, contentType?: string): HttpRequest => ({
  method: 'POST',
  path: '/oauth/token',
  query: new URLSearchParams(),
  headers: contentType === undefined ? {} : { 'content-type': contentType },
  body,
  remoteAddress: '127.0.0.1',
  disconnected: new AbortController().signal,
})

describe('an HTTP exchange', () => {
  it('answers JSON and text that no cache keeps, and lets a caller add headers', () => {
    expect(json(201, { a: 1 }, { 'x-extra': 'yes' })).toEqual({
      status: 201,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-extra': 'yes',
      },
      body: '{"a":1}',
    })
    expect(text(200, 'ok')).toMatchObject({ headers: { 'cache-control': 'no-store' }, body: 'ok' })
    expect(text(200, '<p>', 'text/html').headers['content-type']).toBe('text/html')
  })

  it('answers an API failure with its status and error body', () => {
    const answer = apiFailure(Conflict({ message: 'Already sent.' }))
    expect(answer.status).toBe(409)
    expect(JSON.parse(answer.body as string)).toMatchObject({ error: { message: 'Already sent.' } })
  })

  it('redirects, answers nothing, and adds headers without dropping the ones there', () => {
    expect(redirect('/x', { 'set-cookie': 'a=b' })).toEqual({
      status: 302,
      headers: { location: '/x', 'cache-control': 'no-store', 'set-cookie': 'a=b' },
      body: '',
    })
    expect(noContent()).toEqual({ status: 204, headers: {}, body: '' })
    expect(withHeaders(text(200, 'ok'), { 'x-request-id': 'r1' }).headers).toMatchObject({
      'cache-control': 'no-store',
      'x-request-id': 'r1',
    })
  })

  it('reads form fields from a form or from JSON, keeping only the text fields', () => {
    expect(formFields(request('grant_type=refresh_token&refresh_token=r'))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'r',
    })
    expect(formFields(request('{"client_name":"Desk","redirect_uris":["x"]}', 'application/json'))).toEqual({
      client_name: 'Desk',
    })
    expect(formFields(request('[1,2]', 'application/json; charset=utf-8'))).toEqual({})
    expect(formFields(request('not json', 'application/json'))).toEqual({})
  })

  it('tells an empty body from JSON that does not parse', () => {
    expect(parseJson('  ')).toBeUndefined()
    expect(parseJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseJson('{')).toBe(INVALID_JSON)
  })
})
