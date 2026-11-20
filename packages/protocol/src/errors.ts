import { Schema as S, tagged } from '@homingbird/kernel'

export const Unauthorized = tagged('Unauthorized')<{ readonly message: string }>()
export const Forbidden = tagged('Forbidden')<{ readonly message: string }>()
export const NotFound = tagged('NotFound')<{ readonly message: string }>()
export const Invalid = tagged('Invalid')<{ readonly message: string }>()
export const Conflict = tagged('Conflict')<{ readonly message: string }>()
export const RateLimited = tagged('RateLimited')<{ readonly message: string }>()
export const Unavailable = tagged('Unavailable')<{ readonly message: string }>()

/** The refusal of a send whose draft differs from what the person read; clients match it exactly. */
export const DRAFT_CHANGED = 'This draft changed; read it again.'

export type Unauthorized = ReturnType<typeof Unauthorized>
export type Forbidden = ReturnType<typeof Forbidden>
export type NotFound = ReturnType<typeof NotFound>
export type Invalid = ReturnType<typeof Invalid>
export type Conflict = ReturnType<typeof Conflict>
export type RateLimited = ReturnType<typeof RateLimited>
export type Unavailable = ReturnType<typeof Unavailable>

export type ApiError = Unauthorized | Forbidden | NotFound | Invalid | Conflict | RateLimited | Unavailable
export type ApiErrorTag = ApiError['_tag']

export const HTTP_STATUS: Readonly<Record<ApiErrorTag, number>> = {
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  Invalid: 400,
  Conflict: 409,
  RateLimited: 429,
  Unavailable: 503,
}

export const ErrorBody = S.struct({
  error: S.struct({
    code: S.literal(
      'Unauthorized',
      'Forbidden',
      'NotFound',
      'Invalid',
      'Conflict',
      'RateLimited',
      'Unavailable',
    ),
    message: S.string(),
  }),
})
export type ErrorBody = S.Infer<typeof ErrorBody>

export const toErrorBody = (error: ApiError): ErrorBody => ({
  error: { code: error._tag, message: error.message },
})

export const fromErrorBody = (body: ErrorBody): ApiError =>
  ({ _tag: body.error.code, message: body.error.message }) as ApiError

export const fromStatus = (status: number, message: string): ApiError => {
  const tag = (Object.entries(HTTP_STATUS).find(([, s]) => s === status)?.[0] ?? 'Unavailable') as ApiErrorTag
  return { _tag: tag, message } as ApiError
}
