import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { agentCommand, defaultReader, presetNamed, presetReader } from '../src/agent-presets.ts'
import { type Invocation, USAGE, USAGE_HINT, parseArguments } from '../src/arguments.ts'
import { EXIT } from '../src/failure.ts'

const CLAUDE_AGENT = agentCommand('claude', 'linux')
const CODEX_READER = presetReader(presetNamed('codex')!, 'linux')!

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
    [['--version'], { command: 'version' }],
    [['-v'], { command: 'version' }],
    [['version'], { command: 'version' }],
    [['status', '--version'], { command: 'version' }],
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
    [['open'], { command: 'open', id: null }],
    [['open', 'conv_1'], { command: 'open', id: 'conv_1' }],
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
    [['teaching'], { command: 'teaching' }],
    [
      ['propose', '--topic', 'Refunds', 'check', 'the', 'order'],
      {
        command: 'propose',
        topic: 'Refunds',
        rule: 'check the order',
        kind: null,
        source: null,
        place: null,
        question: null,
        rewriteOf: null,
      },
    ],
    [
      [
        'propose',
        '--topic',
        'Refunds',
        '--answer',
        '--source',
        'https://wiki.example/r',
        '--channel',
        'billing',
        '--question',
        'How?',
        '--rewrite-of',
        'note_1',
        'Within 30 days.',
      ],
      {
        command: 'propose',
        topic: 'Refunds',
        rule: 'Within 30 days.',
        kind: 'answer',
        source: 'https://wiki.example/r',
        place: 'billing',
        question: 'How?',
        rewriteOf: 'note_1',
      },
    ],
    [['stream'], { command: 'stream', after: null }],
    [['stream', '--after', '42'], { command: 'stream', after: 42 }],
    [
      ['login', '--server', 'https://hb.example.com//'],
      {
        command: 'login',
        server: 'https://hb.example.com',
        name: null,
        openBrowser: true,
        force: false,
      },
    ],
    [
      ['login', '--server', 'https://hb.example.com', '--credentials-file', 'agent.json', '--force'],
      {
        command: 'login',
        server: 'https://hb.example.com',
        name: null,
        openBrowser: true,
        force: true,
      },
    ],
    [
      ['login', '--server', 'https://hb.example.com', '--name', 'Laptop', '--no-browser'],
      {
        command: 'login',
        server: 'https://hb.example.com',
        name: 'Laptop',
        openBrowser: false,
        force: false,
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
    [['run', '--agent', 'claude'], { command: 'run', agent: CLAUDE_AGENT, timeoutSeconds: 300, split: null }],
    [
      ['run', '--agent', 'claude', '--split'],
      {
        command: 'run',
        agent: CLAUDE_AGENT,
        timeoutSeconds: 300,
        split: { reader: defaultReader('claude', 'linux'), requireToollessReader: false },
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
    [
      ['run', '--agent', 'claude', '--attach-mcp'],
      { command: 'run', agent: CLAUDE_AGENT, timeoutSeconds: 300, split: null, attachMcp: true },
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
        agent: CLAUDE_AGENT,
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
        agent: CLAUDE_AGENT,
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
      value: { invocation: { split: { reader: defaultReader('claude', 'win32') } } },
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

  it('reads --credentials-file for every command, and --force for login and setup alone', () => {
    expect(parseArguments(['inbox', '--credentials-file', ' /run/secret.json '])).toMatchObject({
      value: { credentialsFile: '/run/secret.json', invocation: { command: 'inbox' } },
    })
    expect(parseArguments(['status'])).toMatchObject({ value: { credentialsFile: null } })
    expect(parseArguments(['--version', '--credentials-file', 'a.json'])).toMatchObject({
      value: { credentialsFile: 'a.json' },
    })
    expect(parseArguments(['--credentials-file', 'a.json'])).toMatchObject({
      value: { credentialsFile: 'a.json', invocation: { command: 'help' } },
    })
    expect(parseArguments(['inbox', '--force'])).toMatchObject({
      _tag: 'Err',
      error: { message: expect.stringContaining('--force goes with login or setup.') },
    })
    expect(parseArguments(['inbox', '--credentials-file'])._tag).toBe('Err')
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
    [['run', '--agent', 'claude', '--service', '--attach-mcp'], /--attach-mcp is for run in a terminal/],
    [['run', '--agent', 'claude', '--split', '--attach-mcp'], /--attach-mcp and --split do not go together/],
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
    [['propose', 'check the order'], /needs --topic/],
    [['propose', '--topic', 'Refunds'], /needs --topic/],
    [['stream', '--after', 'soon'], /--after needs a sequence number/],
    [['stream', '--after', '-1'], /--after needs a sequence number/],
  ])('refuses %j with one sentence and where the usage is', (argv, message) => {
    const failure = refusal(...argv)
    expect(failure.message).toMatch(message)
    expect(failure.message).not.toContain(USAGE)
    expect(failure.message.split('\n')).toHaveLength(2)
    expect(failure.message).toMatch(new RegExp(`\\n${USAGE_HINT}$`))
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

describe('parseArguments for setup', () => {
  const CODE = 'hbj_join-code'
  it('reads the join code from HOMINGBIRD_JOIN_CODE when --join is not given, and prefers --join', () => {
    const fromVariable = parseArguments(['setup', '--server', 'https://hb.test', '--no-service'], 'linux', {
      HOMINGBIRD_JOIN_CODE: ` ${CODE} `,
    })
    expect(fromVariable).toMatchObject({ value: { invocation: { command: 'setup', code: CODE } } })
    const both = parseArguments(
      ['setup', '--server', 'https://hb.test', '--join', 'hbj_given', '--no-service'],
      'linux',
      {
        HOMINGBIRD_JOIN_CODE: CODE,
      },
    )
    expect(both).toMatchObject({ value: { invocation: { code: 'hbj_given' } } })
    expect(parseArguments(['setup', '--server', 'https://hb.test', '--no-service'])._tag).toBe('Err')
  })
})
