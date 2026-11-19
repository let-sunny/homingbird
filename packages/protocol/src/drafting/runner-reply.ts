import { DebateResult } from '../debate-result.ts'
import { NOTE_BASIS_MAX, NoteBody, RELEASE_REASON_MAX, agentLabelOf } from '../model.ts'
import { APPLIED_PREFIX } from '../principles.ts'
import { jsonIn } from './debate-reader.ts'
import { SPLIT_BASIS } from './note-reader.ts'

/** What an agent command printed for a note: a draft with its trailing lines, or a skip with its reason. */
export const runnerReplyIn = (output: string): AgentReply => {
  const text = output.trim()
  const skip = /^SKIP:\s*([\s\S]*)$/i.exec(text)
  if (skip !== null) return { kind: 'skip', reason: skip[1]!.trim().slice(0, RELEASE_REASON_MAX) }
  const lines = text.split('\n')
  const trailing: { basis?: string; model?: string; applied?: string } = {}
  while (lines.length > 1) {
    const last = lines.at(-1)!.trim()
    const basis = trailing.basis === undefined ? /^BASIS:\s*(.*)$/i.exec(last) : null
    const model = trailing.model === undefined ? /^MODEL:\s*(.*)$/i.exec(last) : null
    const applied =
      trailing.applied === undefined && last.toLowerCase().startsWith(APPLIED_PREFIX.toLowerCase())
    if (basis !== null) trailing.basis = basis[1]!.trim()
    else if (model !== null) trailing.model = model[1]!.trim()
    else if (applied) trailing.applied = last
    else break
    lines.pop()
  }
  const model = agentLabelOf(trailing.model)
  return {
    kind: 'draft',
    body: lines.join('\n').trim(),
    basis: [trailing.basis, trailing.applied].filter(Boolean).join('\n').slice(0, NOTE_BASIS_MAX) || null,
    ...(model !== null && { model }),
  }
}

export type AgentReply =
  | {
      readonly kind: 'draft'
      readonly body: string
      readonly basis: string | null
      readonly model?: string | null
    }
  | { readonly kind: 'skip'; readonly reason: string }

export type DraftReply = Extract<AgentReply, { kind: 'draft' }>

export const replyProblem = (reply: AgentReply): string | null => {
  if (reply.kind === 'skip') return null
  if (reply.body === '') return 'printed nothing'
  return NoteBody.decode(reply.body)._tag === 'Ok' ? null : 'printed more than a note can hold'
}

/** The basis a runner's draft carries; in split mode it always says the writer saw only the extraction. */
export const runnerBasisOf = (reply: DraftReply, isSplit: boolean): { basis?: string } => {
  if (isSplit)
    return { basis: [SPLIT_BASIS, reply.basis].filter(Boolean).join('. ').slice(0, NOTE_BASIS_MAX) }
  return reply.basis === null ? {} : { basis: reply.basis }
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
