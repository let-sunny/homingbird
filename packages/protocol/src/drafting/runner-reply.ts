import { DebateResult } from '../debate-result.ts'
import { NoteId } from '../ids.ts'
import {
  AGENT_LABEL_MAX,
  DRAFT_SOURCES_MAX,
  DraftSource,
  NOTE_BASIS_MAX,
  NoteBody,
  RELEASE_REASON_MAX,
  SOURCE_QUOTE_MAX,
  agentLabelOf,
} from '../model.ts'
import { APPLIED_PREFIX } from '../principles.ts'
import { READY_TRAILER } from './debate-prompts.ts'
import { jsonIn } from './debate-reader.ts'
import { SPLIT_BASIS } from './note-reader.ts'

/** What an agent command printed for a note: a draft with its trailing lines, or a skip with its reason. */
export const runnerReplyIn = (output: string): AgentReply => {
  const text = output.trim()
  const skip = /^SKIP:\s*([\s\S]*)$/i.exec(text)
  if (skip !== null) return { kind: 'skip', reason: skip[1]!.trim().slice(0, RELEASE_REASON_MAX) }
  const lines = text.split('\n')
  const trailing: { basis?: string; model?: string; applied?: string } = {}
  const sources: string[] = []
  while (lines.length > 1) {
    const last = lines.at(-1)!.trim()
    const basis = trailing.basis === undefined ? /^BASIS:\s*(.*)$/i.exec(last) : null
    const model = trailing.model === undefined ? /^MODEL:\s*(.*)$/i.exec(last) : null
    const source = /^SOURCE:\s*(.*)$/i.exec(last)
    const applied =
      trailing.applied === undefined && last.toLowerCase().startsWith(APPLIED_PREFIX.toLowerCase())
    if (basis !== null) trailing.basis = basis[1]!.trim()
    else if (model !== null) trailing.model = model[1]!.trim()
    else if (source !== null) sources.unshift(source[1]!.trim())
    else if (applied) trailing.applied = last
    else break
    lines.pop()
  }
  const model = agentLabelOf(trailing.model)
  const read = sources.map((line) => ({ line, source: sourceIn(line) }))
  const unread = read.flatMap(({ line, source }) =>
    source === null && line !== '' ? [`Source: ${line}`] : [],
  )
  return {
    kind: 'draft',
    body: lines.join('\n').trim(),
    basis:
      [trailing.basis, ...unread, trailing.applied].filter(Boolean).join('\n').slice(0, NOTE_BASIS_MAX) ||
      null,
    sources: read.flatMap(({ source }) => (source === null ? [] : [source])).slice(0, DRAFT_SOURCES_MAX),
    ...(model !== null && { model }),
  }
}

export type AgentReply =
  | {
      readonly kind: 'draft'
      readonly body: string
      readonly basis: string | null
      readonly sources: ReadonlyArray<DraftSource>
      readonly model?: string | null
    }
  | { readonly kind: 'skip'; readonly reason: string }

export type DraftReply = Extract<AgentReply, { kind: 'draft' }>

export const replyProblem = (reply: AgentReply): string | null => {
  if (reply.kind === 'skip') return null
  if (reply.body === '') return 'printed nothing'
  return NoteBody.decode(reply.body)._tag === 'Ok' ? null : 'printed more than a note can hold'
}

/**
 * The basis and sources a runner's draft carries; in split mode the basis always says the writer saw only
 * the extraction.
 */
export const runnerBasisOf = (
  reply: DraftReply,
  isSplit: boolean,
): { basis?: string; sources?: ReadonlyArray<DraftSource> } => {
  const sources = reply.sources.length === 0 ? {} : { sources: reply.sources }
  if (isSplit)
    return {
      basis: [SPLIT_BASIS, reply.basis].filter(Boolean).join('. ').slice(0, NOTE_BASIS_MAX),
      ...sources,
    }
  return reply.basis === null ? sources : { basis: reply.basis, ...sources }
}

/** A room answer apart from a last line of exactly `MODEL:` and one name, as `RUNNER_MODEL_LINE` asks. */
export const statedModelIn = (output: string): { readonly answer: string; readonly model: string | null } => {
  const lines = output.trim().split('\n')
  const stated = lines.length > 1 ? /^MODEL:(.*)$/.exec(lines.at(-1)!.trim()) : null
  const model = stated === null ? null : modelNameIn(stated[1]!)
  if (model === null) return { answer: output.trim(), model: null }
  return { answer: lines.slice(0, -1).join('\n').trim(), model }
}

/** A turn apart from a last `READY:` line, before or after `MODEL:`; only `READY_TRAILER` means ready. */
export const statedTurnIn = (output: string): StatedTurn => {
  const readyLast = readyTrailerIn(output)
  if (readyLast.found) return { ...statedModelIn(readyLast.answer), ready: readyLast.ready }
  const stated = statedModelIn(output)
  const readyFirst = readyTrailerIn(stated.answer)
  return { answer: readyFirst.answer, model: stated.model, ready: readyFirst.ready }
}

export interface StatedTurn {
  readonly answer: string
  readonly model: string | null
  readonly ready: boolean
}

/** The result an agent printed, or null for anything but one JSON object in a result's shape. */
export const debateResultIn = (output: string): DebateResult | null => {
  const decoded = DebateResult.decode(jsonIn(output))
  return decoded._tag === 'Ok' ? decoded.value : null
}

/** The agent's choice among the drafts it may vote for, or null for anything but exactly one of them. */
export const voteIn = <C extends string>(output: string, choices: ReadonlyArray<C>): C | null => {
  const chosen = output.trim().replace(/^["'`]+|["'`.]+$/g, '')
  return choices.find((choice) => choice === chosen) ?? null
}

/** A `SOURCE:` line's address or note id, and the passage after " | "; null for anything a source cannot hold. */
const sourceIn = (line: string): DraftSource | null => {
  const [target, ...passage] = line.split(' | ') as [string, ...string[]]
  const quote = passage
    .join(' | ')
    .trim()
    .replace(/^["“]|["”]$/g, '')
    .trim()
    .slice(0, SOURCE_QUOTE_MAX)
  const named = target.trim()
  const decoded = DraftSource.decode({
    ...(NoteId.decode(named)._tag === 'Ok' ? { noteId: named } : { url: named }),
    ...(quote !== '' && { quote }),
  })
  return decoded._tag === 'Ok' ? decoded.value : null
}

const readyTrailerIn = (
  text: string,
): { readonly found: boolean; readonly answer: string; readonly ready: boolean } => {
  const lines = text.trim().split('\n')
  const last = lines.at(-1)!.trim()
  if (!READY_LINE.test(last)) return { found: false, answer: text.trim(), ready: false }
  return { found: true, answer: lines.slice(0, -1).join('\n').trim(), ready: last === READY_TRAILER }
}

const READY_LINE = /^ready\s*:\s*\S+$/i

const modelNameIn = (text: string): string | null => {
  const name = text.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
  return name.length <= AGENT_LABEL_MAX && MODEL_NAME.test(name) ? name : null
}

const MODEL_NAME = /^[\p{L}\p{N}](?:[\p{L}\p{N}._:/@+-]*[\p{L}\p{N}])?$/u
