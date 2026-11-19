import { Stream, Task as T } from '@homingbird/kernel'
import { type McpContext, handleMcpMessage } from './server.ts'

export interface StdioSession {
  readonly input: AsyncIterable<string | Uint8Array>
  readonly write: (line: string) => void
  readonly context: McpContext
}

export const runStdioSession = (session: StdioSession): T.Task<void> =>
  Stream.forEach((line: string) =>
    T.map((reply: T.Exit<unknown | null, never>) => {
      if (reply._tag === 'Ok' && reply.value !== null) session.write(`${JSON.stringify(reply.value)}\n`)
    })(T.exit(answerLine(line, session.context))),
  )(linesOf(session.input))

/** Splits the input into lines, skipping blank ones; the last line counts even without a line break. */
export const linesOf = (chunks: Stream.Stream<string | Uint8Array>): Stream.Stream<string> => ({
  [Symbol.asyncIterator]: () => {
    const decoder = new TextDecoder()
    let buffered = ''
    const complete = Stream.flatMap((chunk: string | Uint8Array) => {
      buffered += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
      const lines = buffered.split('\n')
      buffered = lines.pop() as string
      return lines.filter(isFilled)
    })(chunks)
    const rest = {
      *[Symbol.iterator]() {
        if (isFilled(buffered)) yield buffered
      },
    }
    return Stream.concat(Stream.fromIterable(rest))(complete)[Symbol.asyncIterator]()
  },
})

const isFilled = (line: string): boolean => line.trim() !== ''

const PARSE_ERROR = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }

const answerLine = (line: string, context: McpContext): T.Task<unknown | null> => {
  try {
    return handleMcpMessage(JSON.parse(line), context)
  } catch {
    return T.succeed(PARSE_ERROR)
  }
}
