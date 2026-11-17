export const NO_REPLY = 'NO_REPLY'

export const replyPromptFor = (wrappedNote: string): string =>
  [
    'A colleague sent the note below through Homingbird.',
    'Write the reply you would suggest, using what you know from this session.',
    'Your answer is saved as a draft. The person you work for reads it and decides whether it is sent, so answer with the reply text only: no preamble, no quotation of the note, no markup.',
    `If the note needs no reply, or you do not know enough to answer it, answer exactly ${NO_REPLY}.`,
    '',
    wrappedNote,
  ].join('\n')

export const replyIn = (answer: string): string | null => {
  const reply = answer.trim()
  return reply === '' || reply === NO_REPLY ? null : reply.slice(0, MAX_REPLY_LENGTH)
}

export const bodyOf = (wrappedNote: string): string => {
  const lines = wrappedNote.split('\n')
  const boundaries = lines.flatMap((line, index) => (BOUNDARY.test(line) ? [index] : []))
  const [first, last] = [boundaries[0], boundaries.at(-1)]
  return first === undefined || last === undefined || first === last
    ? ''
    : lines.slice(first + 1, last).join('\n').replaceAll('&lt;', '<')
}

const MAX_REPLY_LENGTH = 16_000
const BOUNDARY = /^-----note-boundary-[0-9a-z]+-----$/
