import { type Result, Task as T, err, ok } from '@homingbird/kernel'
import {
  type ApiError,
  ChannelSlug,
  ConversationId,
  MemberId,
  type Note,
  NoteBody,
  NoteId,
  agentLabelOf,
} from '@homingbird/protocol'
import { A2A_CODE } from './errors.ts'
import { RpcFailure, invalidParams } from './json-rpc.ts'
import type { MemberApi } from './member-api.ts'

export const draftFromMessage = (
  params: Readonly<Record<string, unknown>>,
  api: MemberApi,
): T.Task<Note, RpcFailure | ApiError> =>
  T.gen(function* () {
    const message = recordAt(params, 'message')
    if (message === null) return yield* T.fail(invalidParams('params.message is required.'))
    const body = yield* T.fromResult(bodyOf(message))
    const metadata = { ...recordAt(params, 'metadata'), ...recordAt(message, 'metadata') }
    const labels = labelsOf(metadata)
    if (typeof message.taskId === 'string' && message.taskId !== '')
      return yield* reviseDraft(message.taskId, body, api, labels.model)
    const inReplyTo = NoteId.decode(metadata.inReplyTo)
    if (inReplyTo._tag === 'Ok')
      return yield* api['drafts.create']({ body: { body, inReplyTo: inReplyTo.value, ...labels } })
    const conversationId = ConversationId.decode(message.contextId)
    if (conversationId._tag === 'Ok')
      return yield* api['drafts.create']({ body: { body, conversationId: conversationId.value, ...labels } })
    if (metadata.channel !== undefined) {
      const channel = ChannelSlug.decode(metadata.channel)
      if (channel._tag === 'Err')
        return yield* T.fail(
          invalidParams(
            'message.metadata.channel must be a channel slug from channels.list, such as billing.',
          ),
        )
      return yield* api['drafts.create']({ body: { body, channel: channel.value, ...labels } })
    }
    if (typeof metadata.to !== 'string')
      return yield* T.fail(
        invalidParams(
          'Name the recipient: set message.metadata.to to a member id or email address, message.metadata.channel to a channel slug, message.metadata.inReplyTo to a note id, or message.contextId to a conversation id.',
        ),
      )
    const recipient = yield* recipientNamed(metadata.to, api)
    return yield* api['drafts.create']({ body: { body, to: [recipient], ...labels } })
  })

const bodyOf = (message: Readonly<Record<string, unknown>>): Result.Result<string, RpcFailure> => {
  const parts = Array.isArray(message.parts) ? (message.parts as ReadonlyArray<unknown>) : []
  const texts = parts.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : null))
  if (texts.some((text) => text === null))
    return err(
      RpcFailure({
        code: A2A_CODE.contentTypeNotSupported,
        message: 'Homingbird notes are text and links only. Send text parts.',
      }),
    )
  const body = NoteBody.decode(texts.join('\n'))
  return body._tag === 'Ok'
    ? ok(body.value)
    : err(invalidParams('The message needs between 1 and 16000 characters of text.'))
}

/**
 * What wrote the message, as labels people see next to the note: the calling agent's card name when it
 * sends one, and the model it states. Never validated and never read by a model.
 */
const labelsOf = (
  metadata: Readonly<Record<string, unknown>>,
): { readonly client?: string; readonly model?: string } => {
  const client = agentLabelOf(recordAt(metadata, 'agentCard')?.name)
  const model = agentLabelOf(metadata.model)
  return { ...(client !== null && { client }), ...(model !== null && { model }) }
}

const reviseDraft = (
  taskId: string,
  body: string,
  api: MemberApi,
  model: string | undefined,
): T.Task<Note, RpcFailure | ApiError> => {
  const noteId = NoteId.decode(taskId)
  const unknownTask = RpcFailure({ code: A2A_CODE.taskNotFound, message: `Task not found: ${taskId}` })
  if (noteId._tag === 'Err') return T.fail(unknownTask)
  return T.gen(function* () {
    const note = yield* T.mapError(() => unknownTask)(api['notes.get']({ params: { id: noteId.value } }))
    if (note.status !== 'draft')
      return yield* T.fail(
        RpcFailure({
          code: A2A_CODE.unsupportedOperation,
          message: 'This task is no longer a draft, so it cannot be revised. Send a new message instead.',
        }),
      )
    return yield* api['drafts.update']({
      params: { id: noteId.value },
      body: { body, ...(model !== undefined && { model }) },
    })
  })
}

const recipientNamed = (to: string, api: MemberApi): T.Task<MemberId, RpcFailure | ApiError> => {
  const asId = MemberId.decode(to)
  if (asId._tag === 'Ok') return T.succeed(asId.value)
  return T.flatMap((directory: { entries: ReadonlyArray<{ member: { id: MemberId; email: string } }> }) => {
    const match = directory.entries.find((entry) => entry.member.email.toLowerCase() === to.toLowerCase())
    return match === undefined
      ? T.fail(invalidParams(`No member has the email address ${to}.`))
      : T.succeed(match.member.id)
  })(api['directory.list']({ query: { q: to } }))
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const recordAt = (
  parent: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> | null => {
  const value = parent[key]
  return isRecord(value) ? value : null
}
