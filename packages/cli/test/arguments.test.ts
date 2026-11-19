import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { presetNamed } from '../src/agent-presets.ts'
import { type Invocation, USAGE, parseArguments } from '../src/arguments.ts'
import { EXIT } from '../src/failure.ts'

const CODEX_READER = presetNamed('codex')!.reader!

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
    [['guidance', 'conv_aaaaaaaaaaaa'], { command: 'guidance', conversationId: 'conv_aaaaaaaaaaaa' }],
    [['directory'], { command: 'directory', query: null, channel: null }],
    [['directory', 'june', 'kim'], { command: 'directory', query: 'june kim', channel: null }],
    [['directory', '--channel', 'billing'], { command: 'directory', query: null, channel: 'billing' }],
    [['channels'], { command: 'channels', query: null }],
    [['channels', 'billing', 'refunds'], { command: 'channels', query: 'billing refunds' }],
    [['requests'], { command: 'requests' }],
    [['open'], { command: 'open', conversationId: null }],
    [['open', 'conv_1'], { command: 'open', conversationId: 'conv_1' }],
    [
      ['run', '--agent', 'claude -p'],
      { command: 'run', agent: 'claude -p', timeoutSeconds: 300, split: null },
    ],
    [
      ['run', '--agent', ' codex exec ', '--timeout', '60'],
      { command: 'run', agent: 'codex exec', timeoutSeconds: 60, split: null },
    ],
    [
      ['run', '--agent', 'claude -p', '--split'],
      {
        command: 'run',
        agent: 'claude -p',
        timeoutSeconds: 300,
        split: { reader: 'claude -p', requireToollessReader: false },
      },
    ],
    [
      [
        'run',
        '--agent',
        'claude -p',
        '--split',
        '--reader',
        ' claude -p --tools "" ',
        '--require-toolless-reader',
      ],
      {
        command: 'run',
        agent: 'claude -p',
        timeoutSeconds: 300,
        split: { reader: 'claude -p --tools ""', requireToollessReader: true },
      },
    ],
    [['inbox'], { command: 'inbox', fresh: false }],
    [['inbox', '--fresh'], { command: 'inbox', fresh: true }],
    [['conversation', 'conv_1'], { command: 'conversation', id: 'conv_1' }],
    [['pickup', 'note_1'], { command: 'pickup', noteId: 'note_1' }],
    [['skip', 'note_1'], { command: 'skip', noteId: 'note_1', reason: null }],
    [['skip', 'note_1', 'Not', 'my', 'area.'], { command: 'skip', noteId: 'note_1', reason: 'Not my area.' }],
    [['stream'], { command: 'stream', after: null }],
    [['stream', '--after', '42'], { command: 'stream', after: 42 }],
    [
      ['login', '--server', 'https://hb.example.com//'],
      {
        command: 'login',
        server: 'https://hb.example.com',
        name: null,
        openBrowser: true,
      },
    ],
    [
      ['login', '--server', 'https://hb.example.com', '--name', 'Laptop', '--no-browser'],
      {
        command: 'login',
        server: 'https://hb.example.com',
        name: 'Laptop',
        openBrowser: false,
      },
    ],
    [
      ['draft', '--to', 'june@example.com', 'Is', 'it', 'safe?'],
      {
        command: 'draft',
        target: { kind: 'to', recipient: 'june@example.com' },
        text: 'Is it safe?',
        basis: null,
        model: null,
      },
    ],
    [
      ['draft', '--reply', 'note_1', 'Yes.'],
      {
        command: 'draft',
        target: { kind: 'reply', noteId: 'note_1' },
        text: 'Yes.',
        basis: null,
        model: null,
      },
    ],
    [
      ['draft', '--conversation', 'conv_1', 'Hello'],
      {
        command: 'draft',
        target: { kind: 'conversation', conversationId: 'conv_1' },
        text: 'Hello',
        basis: null,
        model: null,
      },
    ],
    [
      ['draft', '--channel', 'billing', 'Who', 'owns', 'refunds?'],
      {
        command: 'draft',
        target: { kind: 'channel', slug: 'billing' },
        text: 'Who owns refunds?',
        basis: null,
        model: null,
      },
    ],
    [
      ['draft', '--reply', 'note_1', '--basis', 'Read: the runbook', 'Yes.'],
      {
        command: 'draft',
        target: { kind: 'reply', noteId: 'note_1' },
        text: 'Yes.',
        basis: 'Read: the runbook',
        model: null,
      },
    ],
    [
      ['draft', '--reply', 'note_1', '--model', 'claude-opus-5-5', 'Yes.'],
      {
        command: 'draft',
        target: { kind: 'reply', noteId: 'note_1' },
        text: 'Yes.',
        basis: null,
        model: 'claude-opus-5-5',
      },
    ],
    [
      ['draft', '--request', 'dreq_1', 'Done.'],
      {
        command: 'draft',
        target: { kind: 'request', requestId: 'dreq_1' },
        text: 'Done.',
        basis: null,
        model: null,
      },
    ],
    [['run', '--agent', 'claude'], { command: 'run', agent: 'claude -p', timeoutSeconds: 300, split: null }],
    [
      ['run', '--agent', 'claude', '--split'],
      {
        command: 'run',
        agent: 'claude -p',
        timeoutSeconds: 300,
        split: { reader: "claude -p --tools '' --strict-mcp-config", requireToollessReader: false },
      },
    ],
    [
      ['run', '--agent', 'codex', '--split', '--service'],
      {
        command: 'run',
        agent: 'codex exec --skip-git-repo-check --ephemeral --sandbox workspace-write -',
        timeoutSeconds: 300,
        split: { reader: CODEX_READER, requireToollessReader: false },
        isService: true,
      },
    ],
    [['presets'], { command: 'presets' }],
    [
      ['service', 'install', '--agent', 'claude'],
      {
        command: 'service',
        action: 'install',
        agent: 'claude',
        timeoutSeconds: null,
        split: false,
        reader: null,
        requireToollessReader: false,
        workdir: null,
      },
    ],
    [
      [
        'service',
        'install',
        '--agent',
        ' my-agent ',
        '--timeout',
        '90',
        '--split',
        '--reader',
        'r',
        '--require-toolless-reader',
        '--workdir',
        '/srv',
      ],
      {
        command: 'service',
        action: 'install',
        agent: 'my-agent',
        timeoutSeconds: 90,
        split: true,
        reader: 'r',
        requireToollessReader: true,
        workdir: '/srv',
      },
    ],
    [
      ['run', '--agent', 'claude', '--service', '--log', '/l.log'],
      {
        command: 'run',
        agent: 'claude -p',
        timeoutSeconds: 300,
        split: null,
        isService: true,
        logFile: '/l.log',
      },
    ],
    [['service', 'status'], { command: 'service', action: 'status' }],
    [['service', 'stop'], { command: 'service', action: 'stop' }],
    [
      ['run', '--agent', 'claude', '--service', '--workdir', 'C:\\work'],
      {
        command: 'run',
        agent: 'claude -p',
        timeoutSeconds: 300,
        split: null,
        isService: true,
        workdir: 'C:\\work',
      },
    ],
    [['service', 'uninstall'], { command: 'service', action: 'uninstall' }],
    [['desk', 'pause'], { command: 'desk', action: 'pause' }],
    [['desk', 'resume'], { command: 'desk', action: 'resume' }],
  ])('reads %j', (argv, invocation) => {
    expect(parsed(...argv)).toEqual(invocation)
  })

  it('gives the Claude Code preset reader the Windows quoting on Windows', () => {
    const result = parseArguments(['run', '--agent', 'claude', '--split'], 'win32')
    expect(result).toMatchObject({
      value: { invocation: { split: { reader: 'claude -p --tools "" --strict-mcp-config' } } },
    })
  })

  it('takes everything after -- as text, even when it looks like an option', () => {
    expect(parsed('draft', '--reply', 'note_1', '--', '--json', 'approve', '--body')).toEqual({
      command: 'draft',
      target: { kind: 'reply', noteId: 'note_1' },
      text: '--json approve --body',
      basis: null,
      model: null,
    })
    expect(parseArguments(['draft', '--reply', 'note_1', '--', '--json'])).toMatchObject({
      value: { json: false },
    })
  })

  it('reads --json anywhere before --', () => {
    expect(parseArguments(['--json', 'status'])).toMatchObject({ value: { json: true } })
    expect(parseArguments(['status', '--json'])).toMatchObject({ value: { json: true } })
    expect(parseArguments(['status'])).toMatchObject({ value: { json: false } })
  })

  it.each<[string[], RegExp]>([
    [['fly'], /Unknown command "fly"/],
    [['status', '--verbose'], /Unknown option --verbose/],
    [['draft', '--reply', 'note_1', '--client', 'Evil 1.0', 'Yes.'], /Unknown option --client/],
    [['login'], /login needs --server/],
    [['login', '--server'], /--server needs a value/],
    [['conversation'], /Missing the conversation id/],
    [['pickup'], /Missing the note id/],
    [['approve', 'note_1'], /Unknown command "approve"/],
    [['discard', 'note_1'], /Unknown command "discard"/],
    [['login', '--server', 'https://hb.example.com', '--approve-button'], /Unknown option --approve-button/],
    [['draft', 'text only'], /exactly one of --to, --reply, --conversation, --channel or --request/],
    [['draft', '--to', 'a@b.c', '--reply', 'note_1', 'text'], /exactly one of/],
    [['draft', '--channel', 'billing', '--request', 'dreq_1', 'text'], /exactly one of/],
    [['run'], /run needs --agent/],
    [['run', '--agent', '  '], /run needs --agent/],
    [['run', '--agent', 'claude -p', '--timeout', 'soon'], /--timeout needs a number of seconds/],
    [['run', '--agent', 'claude -p', '--timeout', '0'], /--timeout needs a number of seconds/],
    [
      ['run', '--agent', 'claude -p', '--reader', 'x'],
      /--reader and --require-toolless-reader go with --split/,
    ],
    [['run', '--agent', 'claude -p', '--require-toolless-reader'], /go with --split/],
    [['service'], /service needs install, status, stop or uninstall/],
    [['service', 'start'], /service needs install, status, stop or uninstall/],
    [['run', '--agent', 'claude', '--workdir', '/w'], /--log and --workdir go with --service/],
    [['service', 'install'], /service install needs --agent/],
    [['service', 'install', '--agent', 'claude', '--reader', 'r'], /go with --split/],
    [['service', 'install', '--agent', 'claude', '--require-toolless-reader'], /go with --split/],
    [['service', 'install', '--agent', 'claude', '--timeout', 'soon'], /--timeout needs a number/],
    [['run', '--agent', 'claude', '--log', '/l.log'], /--log and --workdir go with --service/],
    [['desk'], /desk needs pause or resume/],
    [['desk', 'stop'], /desk needs pause or resume/],
    [['toString'], /Unknown command "toString"/],
    [['constructor'], /Unknown command "constructor"/],
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
      'open',
      'channels',
      'requests',
      'run',
    ])
      expect(USAGE).toMatch(new RegExp(`^  ${command}\\b`, 'm'))
  })

  it('never turns draft text into another command or option, whatever the text is', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 5 }),
        (words) => {
          const result = parseArguments(['draft', '--reply', 'note_1', '--', ...words])
          if (words.join(' ').trim() === '') expect(result._tag).toBe('Err')
          else
            expect(result).toMatchObject({
              _tag: 'Ok',
              value: { json: false, invocation: { command: 'draft', text: words.join(' ').trim() } },
            })
        },
      ),
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
