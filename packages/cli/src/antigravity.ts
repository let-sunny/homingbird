import { Result, Schema as S } from '@homingbird/kernel'

/**
 * The prompt as the one user event the Antigravity CLI reads with `--input-format=stream-json`. An
 * empty `--print=` makes it read standard input instead of taking the next option for the prompt.
 */
export const antigravityInput = (prompt: string): string =>
  `${JSON.stringify({ event: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } })}\n`

/**
 * The reply in what the Antigravity CLI printed with `--output-format=stream-json`: the response of
 * its last `result` event, or why there is none. A line that is not a result event is skipped.
 */
export const antigravityOutput = (printed: string): Result.Result<string, string> => {
  let response: string | null = null
  for (const line of printed.split(/\r?\n/)) {
    const value = parsedJson(line)
    const event = StreamEvent.read(value)
    if (event._tag === 'Err' || event.value.event !== 'result') continue
    const result = ResultEvent.read(value)
    if (result._tag === 'Err') return Result.err('printed a result event without a status')
    const { status, response: said } = result.value.result
    if (status !== 'SUCCESS') return Result.err(`reported ${statusLabel(status)} instead of a response`)
    if (said === undefined) return Result.err('printed a result event without a response')
    response = said
  }
  return response === null ? Result.err('printed no result event') : Result.ok(response)
}

/** Antigravity's print mode, reading one prompt event and writing events; `--sandbox` keeps it from writing files. */
export const ANTIGRAVITY_PRINT: ReadonlyArray<string> = [
  ...['agy', '--print=', '--input-format=stream-json', '--output-format=stream-json', '--sandbox'],
]

/** Every tool Antigravity names is denied to the reader, reading files included. */
export const ANTIGRAVITY_READER_SETTINGS = {
  toolPermission: 'request-review',
  permissions: {
    deny: ['read_file(*)', 'write_file(*)', 'command(*)', 'mcp(*)', 'read_url(*)', 'execute_url(*)'],
  },
}

const StreamEvent = S.struct({ event: S.string() })

const ResultEvent = S.struct({
  result: S.struct({ status: S.string(), response: S.optional(S.string()) }),
})

/** A status is the CLI's own word, such as ERROR; anything longer is not repeated, as it could quote a note. */
const statusLabel = (status: string): string => (/^[A-Z_]{1,40}$/.test(status) ? status : 'a failure')

const parsedJson = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}
