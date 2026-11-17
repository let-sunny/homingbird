import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type Invocation, USAGE, parseArguments } from '../src/arguments.ts'
import { EXIT } from '../src/failure.ts'

const parsed = (...argv: string[]): Invocation => {
  const result = parseArguments(argv)
  if (result._tag === 'Err') throw new Error(result.error.message)
  return result.value.invocation
}

const refusal = (...argv: string[]) => {
  const result = parseArguments(argv)
  if (result._tag === 'Ok') throw new Error(`expected a usage error for ${argv.join(' ')}`)
  return result.error
}

describe('parseArguments', () => {
  it.each<[string[], Invocation]>([
    [[], { command: 'help' }],
    [['help'], { command: 'help' }],
    [['status', '--help'], { command: 'help' }],
    [['logout'], { command: 'logout' }],
    [['status'], { command: 'status' }],
    [['conversations'], { command: 'conversations' }],
    [['drafts'], { command: 'drafts' }],
    [['overview'], { command: 'overview' }],
    [['directory'], { command: 'directory', query: null }],
    [['directory', 'june', 'kim'], { command: 'directory', query: 'june kim' }],
    [['inbox'], { command: 'inbox', fresh: false }],
    [['inbox', '--fresh'], { command: 'inbox', fresh: true }],
    [['conversation', 'conv_1'], { command: 'conversation', id: 'conv_1' }],
    [['pickup', 'note_1'], { command: 'pickup', noteId: 'note_1' }],
    [['stream'], { command: 'stream', after: null }],
    [['stream', '--after', '42'], { command: 'stream', after: 42 }],
    [['approve', 'note_1'], { command: 'approve', draftId: 'note_1', body: null }],
    [['approve', 'note_1', '--body', 'Edited text'], { command: 'approve', draftId: 'note_1', body: 'Edited text' }],
    [['discard', 'note_1'], { command: 'discard', draftId: 'note_1' }],
    [
      ['login', '--server', 'https://hb.example.com//'],
      { command: 'login', server: 'https://hb.example.com', name: null, approveButton: false },
    ],
    [
      ['login', '--server', 'https://hb.example.com', '--name', 'Laptop', '--approve-button'],
      { command: 'login', server: 'https://hb.example.com', name: 'Laptop', approveButton: true },
    ],
    [
      ['draft', '--to', 'june@example.com', 'Is', 'it', 'safe?'],
      { command: 'draft', target: { kind: 'to', recipient: 'june@example.com' }, text: 'Is it safe?' },
    ],
    [
      ['draft', '--reply', 'note_1', 'Yes.'],
      { command: 'draft', target: { kind: 'reply', noteId: 'note_1' }, text: 'Yes.' },
    ],
    [
      ['draft', '--conversation', 'conv_1', 'Hello'],
      { command: 'draft', target: { kind: 'conversation', conversationId: 'conv_1' }, text: 'Hello' },
    ],
  ])('reads %j', (argv, invocation) => {
    expect(parsed(...argv)).toEqual(invocation)
  })

  it('takes everything after -- as text, even when it looks like an option', () => {
    expect(parsed('draft', '--reply', 'note_1', '--', '--json', 'approve', '--body')).toEqual({
      command: 'draft',
      target: { kind: 'reply', noteId: 'note_1' },
      text: '--json approve --body',
    })
    expect(parseArguments(['draft', '--reply', 'note_1', '--', '--json'])).toMatchObject({ value: { json: false } })
  })

  it('reads --json anywhere before --', () => {
    expect(parseArguments(['--json', 'status'])).toMatchObject({ value: { json: true } })
    expect(parseArguments(['status', '--json'])).toMatchObject({ value: { json: true } })
    expect(parseArguments(['status'])).toMatchObject({ value: { json: false } })
  })

  it.each<[string[], RegExp]>([
    [['fly'], /Unknown command "fly"/],
    [['status', '--verbose'], /Unknown option --verbose/],
    [['login'], /login needs --server/],
    [['login', '--server'], /--server needs a value/],
    [['conversation'], /Missing the conversation id/],
    [['pickup'], /Missing the note id/],
    [['approve'], /Missing the draft id/],
    [['discard'], /Missing the draft id/],
    [['draft', 'text only'], /exactly one of --to, --reply or --conversation/],
    [['draft', '--to', 'a@b.c', '--reply', 'note_1', 'text'], /exactly one of/],
    [['draft', '--to', 'a@b.c'], /needs some text/],
    [['draft', '--to', 'a@b.c', '   '], /needs some text/],
    [['stream', '--after', 'soon'], /--after needs a sequence number/],
    [['stream', '--after', '-1'], /--after needs a sequence number/],
  ])('refuses %j with a usage error', (argv, message) => {
    const failure = refusal(...argv)
    expect(failure.message).toMatch(message)
    expect(failure.message).toContain(USAGE)
    expect(failure.exitCode).toBe(EXIT.usage)
  })

  it('lists every command in its usage text', () => {
    for (const command of [
      'login',
      'logout',
      'status',
      'directory',
      'inbox',
      'conversations',
      'conversation',
      'draft',
      'drafts',
      'overview',
      'pickup',
      'stream',
      'approve',
      'discard',
    ])
      expect(USAGE).toMatch(new RegExp(`^  ${command}\\b`, 'm'))
  })

  it('never turns draft text into another command or option, whatever the text is', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 5 }), (words) => {
        const result = parseArguments(['draft', '--reply', 'note_1', '--', ...words])
        if (words.join(' ').trim() === '') expect(result._tag).toBe('Err')
        else
          expect(result).toMatchObject({
            _tag: 'Ok',
            value: { json: false, invocation: { command: 'draft', text: words.join(' ').trim() } },
          })
      }),
    )
  })

  it('never throws, whatever it is given', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 16 }), { maxLength: 6 }), (argv) => {
        expect(['Ok', 'Err']).toContain(parseArguments(argv)._tag)
      }),
    )
  })
})
