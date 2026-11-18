import { Task as T } from '@homingbird/kernel'
import { type McpContext, handleMcpMessage } from './server.ts'

export interface StdioSession {
  readonly input: AsyncIterable<string | Uint8Array>
  readonly write: (line: string) => void
  readonly context: McpContext
}

export const runStdioSession = (session: StdioSession): T.Task<void> =>
  T.promise(async (signal) => {
    for await (const line of linesOf(session.input)) {
      if (signal.aborted) return
      const reply = await T.run(answerLine(line, session.context), undefined, signal)
      if (reply._tag === 'Ok' && reply.value !== null) session.write(`${JSON.stringify(reply.value)}\n`)
    }
  })

export const linesOf = async function* (
  chunks: AsyncIterable<string | Uint8Array>,
): AsyncGenerator<string, void> {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const chunk of chunks) {
    buffered += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    const lines = buffered.split('\n')
    buffered = lines.pop() as string
    for (const line of lines) if (line.trim() !== '') yield line
  }
  if (buffered.trim() !== '') yield buffered
}

const PARSE_ERROR = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }

const answerLine = (line: string, context: McpContext): T.Task<unknown | null> => {
  try {
    return handleMcpMessage(JSON.parse(line), context)
  } catch {
    return T.succeed(PARSE_ERROR)
  }
}
