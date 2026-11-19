import { Stream } from '@homingbird/kernel'

export interface ServerSentMessage {
  readonly id: string | null
  readonly event: string
  readonly data: string
}

export const parseServerSentEvents = (chunks: Stream.Stream<string>): Stream.Stream<ServerSentMessage> =>
  Stream.flatMap((state: ParserState) => state.complete)(Stream.scan(START, readChunk)(chunks))

interface ParserState {
  readonly buffered: string
  readonly pending: PendingMessage
  readonly complete: ReadonlyArray<ServerSentMessage>
}

interface PendingMessage {
  readonly id: string | null
  readonly event: string
  readonly data: ReadonlyArray<string>
}

const EMPTY_MESSAGE: PendingMessage = { id: null, event: 'message', data: [] }

const START: ParserState = { buffered: '', pending: EMPTY_MESSAGE, complete: [] }

const readChunk = (state: ParserState, chunk: string): ParserState => {
  const lines = (state.buffered + chunk).split(/\r\n|\r|\n/)
  const buffered = lines.pop()!
  let pending = state.pending
  const complete: ServerSentMessage[] = []
  for (const line of lines) {
    if (line !== '') {
      pending = withField(pending, line)
      continue
    }
    if (pending.data.length > 0)
      complete.push({ id: pending.id, event: pending.event, data: pending.data.join('\n') })
    pending = EMPTY_MESSAGE
  }
  return { buffered, pending, complete }
}

const withField = (message: PendingMessage, line: string): PendingMessage => {
  if (line.startsWith(':')) return message
  const separator = line.indexOf(':')
  const field = separator === -1 ? line : line.slice(0, separator)
  const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '')
  if (field === 'data') return { ...message, data: [...message.data, value] }
  if (field === 'event') return { ...message, event: value }
  if (field === 'id') return { ...message, id: value }
  return message
}
