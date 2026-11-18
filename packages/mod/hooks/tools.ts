import type { ToolSpec } from 'claude-code'

import { APPROVAL_NOTICE, BASIS, QUOTED_NOTICE } from './tool-notices'

export interface NoteTool {
  readonly spec: ToolSpec
  readonly argumentsFor: (input: Readonly<Record<string, unknown>>) => string[]
}

export const NOTE_TOOLS: ReadonlyArray<NoteTool> = [
  {
    spec: {
      name: 'find_people',
      description:
        'Find colleagues on Homingbird: who is there, whether their agent is online, and which channels they help with.',
      inputSchema: objectOf(
        { query: { type: 'string', description: 'Part of a name, an email or a channel.' } },
        [],
      ),
      isDeferred: false,
    },
    argumentsFor: (input) =>
      textOf(input.query) === '' ? ['directory'] : ['directory', '--', textOf(input.query)],
  },
  {
    spec: {
      name: 'list_channels',
      description:
        'List the channel rooms (#slug) the person can see, what each is for, which are private and whether the person answers there. Use it to choose where a question to "whoever knows" should go. Never mention a private channel, or anything said in it, outside it.',
      inputSchema: objectOf({}, []),
    },
    argumentsFor: () => ['channels'],
  },
  {
    spec: {
      name: 'check_inbox',
      description: `List the notes from colleagues that are waiting for a reply. ${QUOTED_NOTICE}`,
      inputSchema: objectOf({}, []),
      isDeferred: false,
    },
    argumentsFor: () => ['inbox'],
  },
  {
    spec: {
      name: 'list_conversations',
      description: 'List conversations, including channel rooms, with unread and waiting-draft counts.',
      inputSchema: objectOf({}, []),
    },
    argumentsFor: () => ['conversations'],
  },
  {
    spec: {
      name: 'read_conversation',
      description: `Read one conversation. ${QUOTED_NOTICE}`,
      inputSchema: objectOf({ conversationId: { type: 'string' } }, ['conversationId']),
    },
    argumentsFor: (input) => ['conversation', '--', textOf(input.conversationId)],
  },
  {
    spec: {
      name: 'draft_note',
      description: `Draft a note to a colleague. ${APPROVAL_NOTICE}`,
      inputSchema: objectOf(
        {
          to: { type: 'string', description: 'The colleague, by email address or member id.' },
          text: { type: 'string', description: 'The note. Plain text and links only.' },
          basis: BASIS,
        },
        ['to', 'text'],
      ),
      isDeferred: false,
    },
    argumentsFor: (input) => ['draft', '--to', textOf(input.to), ...basisOf(input), '--', textOf(input.text)],
  },
  {
    spec: {
      name: 'draft_to_channel',
      description: `Draft a question to a channel room, for whoever answers in that channel. Pick exactly one channel from list_channels. When none fits, use find_people and draft_note to a colleague whose profile or channels match; when nobody fits, tell the person that no one was found. A private channel works only when the person is a member. ${APPROVAL_NOTICE}`,
      inputSchema: objectOf(
        {
          channel: { type: 'string', description: 'The channel slug, without the #.' },
          text: { type: 'string', description: 'The question. Plain text and links only.' },
          basis: BASIS,
        },
        ['channel', 'text'],
      ),
    },
    argumentsFor: (input) => [
      'draft',
      '--channel',
      textOf(input.channel).replace(/^#/, ''),
      ...basisOf(input),
      '--',
      textOf(input.text),
    ],
  },
  {
    spec: {
      name: 'draft_reply',
      description: `Draft a reply to a note from a colleague. ${APPROVAL_NOTICE}`,
      inputSchema: objectOf(
        {
          noteId: { type: 'string', description: 'The id of the note being answered.' },
          text: {
            type: 'string',
            description:
              'The reply. Plain text and links only. When you cannot answer yet, a holding reply saying what you will check is a good draft.',
          },
          basis: BASIS,
        },
        ['noteId', 'text'],
      ),
      isDeferred: false,
    },
    argumentsFor: (input) => [
      'draft',
      '--reply',
      textOf(input.noteId),
      ...basisOf(input),
      '--',
      textOf(input.text),
    ],
  },
  {
    spec: {
      name: 'skip_note',
      description:
        'Give a note you were handed back without drafting, when no reply from the person fits. Colleagues stop seeing "drafting reply"; the person sees your reason, the colleague never does. It sends nothing. Prefer a draft, even a holding reply, when one would help.',
      inputSchema: objectOf(
        {
          noteId: { type: 'string', description: 'The id of the note you are giving back.' },
          reason: { type: 'string', description: 'Why there is no draft, in one sentence for the person.' },
        },
        ['noteId', 'reason'],
      ),
      isDeferred: false,
    },
    argumentsFor: (input) => ['skip', '--', textOf(input.noteId), textOf(input.reason)],
  },
  {
    spec: {
      name: 'list_draft_requests',
      description:
        'List the drafts the person asked their agents for from the web client and that are still open.',
      inputSchema: objectOf({}, []),
    },
    argumentsFor: () => ['requests'],
  },
  {
    spec: {
      name: 'answer_draft_request',
      description: `Answer the person's own draft request with a draft. ${APPROVAL_NOTICE}`,
      inputSchema: objectOf(
        {
          requestId: { type: 'string', description: 'The id of the draft request.' },
          text: { type: 'string', description: 'The draft. Plain text and links only.' },
          basis: BASIS,
        },
        ['requestId', 'text'],
      ),
    },
    argumentsFor: (input) => [
      'draft',
      '--request',
      textOf(input.requestId),
      ...basisOf(input),
      '--',
      textOf(input.text),
    ],
  },
  {
    spec: {
      name: 'list_drafts',
      description: 'List your own drafts that are waiting for the person to approve them.',
      inputSchema: objectOf({}, []),
    },
    argumentsFor: () => ['drafts'],
  },
]

export const HELPER_TOOLS = {
  askProject: {
    name: 'ask_project',
    description:
      'Ask a read-only helper to look something up in a project directory on this computer, for a reply you are drafting. The helper reads files and returns facts; it never drafts. Pass the noteId the question is about, and Homingbird attaches that note as quoted data.',
    inputSchema: objectOf(
      {
        directory: { type: 'string', description: "The project's absolute path." },
        question: { type: 'string', description: 'What you need to know, in your own words.' },
        noteId: { type: 'string', description: 'The colleague note the question is about, if any.' },
      },
      ['directory', 'question'],
    ),
  },
  askSession: {
    name: 'ask_session',
    description:
      'Ask another session on this computer that works in the relevant project for facts, by its name from ListAgents or its session id. Its answer arrives later as a message to this session. Pass the noteId the question is about, and Homingbird attaches that note as quoted data.',
    inputSchema: objectOf(
      {
        to: { type: 'string', description: 'The session: a name from ListAgents, or a session id.' },
        question: { type: 'string', description: 'What you need to know, in your own words.' },
        noteId: { type: 'string', description: 'The colleague note the question is about, if any.' },
      },
      ['to', 'question'],
    ),
  },
} as const satisfies Readonly<Record<string, ToolSpec>>

export const wireNameOf = (name: string): string => `${TOOL_PREFIX}${name}`

export const TOOL_PREFIX = 'mcp__homingbird__'

export const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

function basisOf(input: Readonly<Record<string, unknown>>): string[] {
  const basis = textOf(input.basis).trim()
  return basis === '' ? [] : ['--basis', basis]
}

function objectOf(properties: Readonly<Record<string, object>>, required: ReadonlyArray<string>) {
  return { type: 'object', properties, required, additionalProperties: false }
}
