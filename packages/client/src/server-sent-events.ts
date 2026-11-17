export interface ServerSentMessage {
  readonly id: string | null
  readonly event: string
  readonly data: string
}

export const parseServerSentEvents = async function* (
  chunks: AsyncIterable<string>,
): AsyncGenerator<ServerSentMessage, void> {
  let buffered = ''
  let pending = emptyMessage()
  for await (const chunk of chunks) {
    buffered += chunk
    const lines = buffered.split(/\r\n|\r|\n/)
    buffered = lines.pop()!
    for (const line of lines) {
      if (line !== '') {
        pending = withField(pending, line)
        continue
      }
      if (pending.data.length > 0)
        yield { id: pending.id, event: pending.event, data: pending.data.join('\n') }
      pending = emptyMessage()
    }
  }
}

interface PendingMessage {
  readonly id: string | null
  readonly event: string
  readonly data: ReadonlyArray<string>
}

const emptyMessage = (): PendingMessage => ({ id: null, event: 'message', data: [] })

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
