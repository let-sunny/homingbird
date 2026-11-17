import { type ApiError, HTTP_STATUS, toErrorBody } from '@homingbird/protocol'

export interface HttpRequest {
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly remoteAddress: string
  readonly disconnected: AbortSignal
}

export interface HttpResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string | Uint8Array | AsyncIterable<string>
}

export const json = (status: number, value: unknown, headers: Readonly<Record<string, string>> = {}): HttpResponse => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  body: JSON.stringify(value),
})

export const apiFailure = (error: ApiError, headers: Readonly<Record<string, string>> = {}): HttpResponse =>
  json(HTTP_STATUS[error._tag], toErrorBody(error), headers)

export const text = (status: number, body: string, contentType = 'text/plain; charset=utf-8'): HttpResponse => ({
  status,
  headers: { 'content-type': contentType, 'cache-control': 'no-store' },
  body,
})

export const redirect = (location: string, headers: Readonly<Record<string, string>> = {}): HttpResponse => ({
  status: 302,
  headers: { location, 'cache-control': 'no-store', ...headers },
  body: '',
})

export const noContent = (headers: Readonly<Record<string, string>> = {}): HttpResponse => ({
  status: 204,
  headers,
  body: '',
})

export const withHeaders = (response: HttpResponse, headers: Readonly<Record<string, string>>): HttpResponse => ({
  ...response,
  headers: { ...response.headers, ...headers },
})

export const formFields = (request: HttpRequest): Readonly<Record<string, string>> => {
  if ((request.headers['content-type'] ?? '').includes('application/json')) {
    const parsed = parseJson(request.body)
    return typeof parsed === 'object' && parsed !== null ? stringFields(parsed as Record<string, unknown>) : {}
  }
  return Object.fromEntries(new URLSearchParams(request.body))
}

export const parseJson = (body: string): unknown => {
  if (body.trim() === '') return undefined
  try {
    return JSON.parse(body)
  } catch {
    return INVALID_JSON
  }
}

export const INVALID_JSON = Symbol('invalid JSON')

const stringFields = (record: Readonly<Record<string, unknown>>): Record<string, string> =>
  Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
