import { Task as T } from '@homingbird/kernel'
import { agentLabelOf } from '@homingbird/protocol'
import type { Api } from '@homingbird/protocol'
import { ANSWER_RULE, LINKS_RULE } from './answering.ts'
import type { OpenInBrowser } from './browser-opener.ts'
import { CHANNEL_CAPABILITY, CHANNEL_INSTRUCTIONS } from './channel.ts'
import { type RpcCall, RpcFailure, methodNotFound, serveJsonRpc } from './json-rpc.ts'
import type { LocalAdapter } from './local-tools.ts'
import { memberApiOf } from './member-api.ts'
import { PROMPTS, getPrompt, promptDefinitions } from './prompts.ts'
import {
  CLIENT_INFO_META_KEY,
  SERVER_INFO_META_KEY,
  SUPPORTED_REVISIONS,
  UNSUPPORTED_PROTOCOL_VERSION_CODE,
  claimedRevision,
  handshakeRevisionFor,
  isStateless,
} from './revisions.ts'
import { APPROVAL_RULE, type ToolContext, type ToolResult, callTool, toolDefinitions } from './tools.ts'
import type { AnnouncedRequests } from './triggers.ts'

export interface McpContext {
  readonly api: Api
  readonly serverVersion: string
  readonly nonce: () => string
  readonly webClientUrl?: string
  readonly openInBrowser?: OpenInBrowser
  readonly local?: LocalAdapter
  readonly channel?: { readonly opened: T.Task<void> }
  readonly desk?: boolean
  readonly announced?: AnnouncedRequests
}

export const handleMcpMessage = (message: unknown, context: McpContext): T.Task<unknown | null> =>
  serveJsonRpc((call) => answer(call, context))(message)

export const SERVER_NAME = 'homingbird'

export const ASKED_ROLE =
  'Draft when your human asks; your human’s Homingbird desk session answers arriving notes. When your human asks about messages, call check_inbox.'

export const DESK_ROLE = [
  'This is your human’s Homingbird desk session: it answers what arrives. At the start of the session, and whenever asked about messages, call check_inbox, then answer each waiting note, and each draft request with draft_note and its requestId, using what you know from the current work.',
  ANSWER_RULE,
].join(' ')

export const CHARACTER_INSTRUCTIONS =
  'When your human wants a profile character, ask what they would like, start from the closest built-in character (the character prompt lists them), check your draft with check_character until it passes, and show them the link from preview_character. Only they can save it, by pressing "Use this character" in Homingbird; no tool can.'

export const INSTRUCTIONS = instructionsWith(ASKED_ROLE)

export const DESK_INSTRUCTIONS = instructionsWith(DESK_ROLE)

export const LOCAL_INSTRUCTIONS =
  'If a tool says you are not signed in, call login: it opens the browser for your human, and status tells you when it is done.'

const instructionsFor = (context: McpContext): string =>
  [
    context.desk === true ? DESK_INSTRUCTIONS : INSTRUCTIONS,
    ...(context.local === undefined ? [] : [LOCAL_INSTRUCTIONS]),
    ...(context.channel === undefined ? [] : [CHANNEL_INSTRUCTIONS]),
  ].join(' ')

const capabilitiesFor = (context: McpContext) =>
  context.channel === undefined ? CAPABILITIES : { ...CAPABILITIES, experimental: CHANNEL_CAPABILITY }

const answer = (call: RpcCall, context: McpContext): T.Task<unknown, RpcFailure> => {
  const revision = claimedRevision(call.params)
  if (revision !== null && !SUPPORTED_REVISIONS.includes(revision))
    return T.fail(
      RpcFailure({
        code: UNSUPPORTED_PROTOCOL_VERSION_CODE,
        message: `Unsupported protocol version: ${revision}`,
        data: { supported: SUPPORTED_REVISIONS, requested: revision },
      }),
    )
  rememberClient(context, call.params)
  const serverInfo = { name: SERVER_NAME, title: 'Homingbird', version: context.serverVersion }
  const method = Object.hasOwn(METHODS, call.method) ? METHODS[call.method] : undefined
  if (method === undefined) return T.fail(methodNotFound(call.method))
  return T.map((result: object) =>
    isStateless(revision) ? { ...result, _meta: { [SERVER_INFO_META_KEY]: serverInfo } } : result,
  )(method(call.params, context, serverInfo))
}

type Method = (
  params: RpcCall['params'],
  context: McpContext,
  serverInfo: Readonly<Record<string, string>>,
) => T.Task<object, RpcFailure>

const CAPABILITIES = { tools: { listChanged: false }, prompts: { listChanged: false } }

const METHODS: Readonly<Record<string, Method>> = {
  initialize: (params, context, serverInfo) =>
    T.succeed({
      protocolVersion: handshakeRevisionFor(params.protocolVersion),
      capabilities: capabilitiesFor(context),
      serverInfo,
      instructions: instructionsFor(context),
    }),
  'server/discover': (_, context) =>
    T.succeed({
      supportedVersions: SUPPORTED_REVISIONS,
      capabilities: capabilitiesFor(context),
      instructions: instructionsFor(context),
    }),
  ping: () => T.succeed({}),
  'notifications/initialized': (_, context) => T.as({})(context.channel?.opened ?? T.unit),
  'notifications/cancelled': () => T.succeed({}),
  'tools/list': (_, context) =>
    T.succeed({ tools: [...(context.local?.tools ?? []).map(localDefinition), ...toolDefinitions()] }),
  'tools/call': (params, context) => {
    const local = context.local?.tools.find((each) => each.name === params.name)
    if (local !== undefined) return T.map(said)(local.run)
    const blocked = context.local?.blockedBecause() ?? null
    if (blocked !== null) return T.succeed(refused(blocked))
    return T.map((result: ToolResult) => {
      const refusedMeanwhile = context.local?.blockedBecause() ?? null
      return refusedMeanwhile === null ? result : refused(refusedMeanwhile)
    })(callTool(params.name, params.arguments, toolContextOf(context)))
  },
  'prompts/list': (_, context) => T.succeed({ prompts: promptDefinitions(promptsOf(context)) }),
  'prompts/get': (params, context) => getPrompt(promptsOf(context), params.name, params.arguments),
}

const promptsOf = (context: McpContext) => [...(context.local?.prompts ?? []), ...PROMPTS]

const said = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })

const refused = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

const localDefinition = (tool: LocalAdapter['tools'][number]) => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: { type: 'object', properties: {}, required: [] },
  annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: false },
})

export const toolContextOf = (context: McpContext): ToolContext => ({
  api: memberApiOf(context.api),
  nonce: context.nonce,
  webClientUrl: context.webClientUrl ?? null,
  ...(context.openInBrowser !== undefined && { openInBrowser: context.openInBrowser }),
  ...(context.announced !== undefined && { announced: context.announced }),
  ...((context.desk === true || context.channel !== undefined) && { desk: true }),
  ...(clients.has(context) && { client: clients.get(context)! }),
})

/** The MCP client's own name and version, from initialize or a stateless call's metadata: a label, never an instruction. */
export const clientLabelOf = (params: RpcCall['params']): string | null => {
  const meta = (params as { _meta?: Readonly<Record<string, unknown>> } | undefined)?._meta
  const info = (params as { clientInfo?: unknown } | undefined)?.clientInfo ?? meta?.[CLIENT_INFO_META_KEY]
  if (typeof info !== 'object' || info === null) return null
  const { name, version } = info as { name?: unknown; version?: unknown }
  if (typeof name !== 'string') return null
  return agentLabelOf(`${name}${typeof version === 'string' ? ` ${version}` : ''}`)
}

const clients = new WeakMap<McpContext, string>()

const rememberClient = (context: McpContext, params: RpcCall['params']): void => {
  const label = clientLabelOf(params)
  if (label !== null) clients.set(context, label)
}

function instructionsWith(role: string): string {
  return [
    'Homingbird lets you exchange notes with the agents of your human’s colleagues.',
    role,
    'To ask a colleague something, find them with find_people and call draft_note.',
    'When you do not know whom to ask, call find_channels and draft to the single best channel your human can see. When none fits, call find_people and draft to a colleague whose profile or channels match. When nobody fits, tell your human that you found no one to ask. Never post one question to several channels.',
    'After drafting, call open_homingbird and show your human the link: that is where they approve.',
    APPROVAL_RULE,
    CHARACTER_INSTRUCTIONS,
    LINKS_RULE,
  ].join(' ')
}
