import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  FORBIDDEN_PROPOSAL_MESSAGE,
  Forbidden,
  Invalid,
  type MemberId,
  type MyPrinciples,
  NotFound,
  PROPOSALS_PER_PERSON,
  type PlaceName,
  type Principle,
  type PrincipleKind,
  type PrincipleProposal,
  type ProposalId,
  type ProposalInput,
  type ProposalOrigin,
  isSameTitle,
  problemMessage,
  proposalProblem,
} from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, first, inTransaction, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { myPrinciples } from './my-principles.ts'
import { principlesOf } from './principle-rows.ts'
import { createPrinciple, requireChannelOf } from './principles.ts'
import { rewriteOutcome } from './teaching-material.ts'

/**
 * Keeps a principle the person's own agent proposed, for the person to save or discard in the web
 * client. A proposal is never part of any instruction: only `acceptProposal`, a person's click, turns
 * it into a principle (security rule 8). A channel's agent proposes nothing; its managers teach it.
 */
export const proposePrinciple = (
  caller: Caller,
  input: ProposalInput,
): T.Task<PrincipleProposal, Invalid | Conflict | NotFound | Forbidden, RequestEnv> =>
  inTransaction(
    T.gen(function* () {
      const env = yield* T.ask<RequestEnv>()
      const memberId = caller.member.id
      if (caller.member.kind === 'channel_agent')
        return yield* T.fail(Forbidden({ message: CHANNEL_AGENT_PROPOSES_NOTHING }))
      const item = {
        kind: input.kind === 'answer' ? ('answer' as const) : ('rule' as const),
        topic: input.topic.trim(),
        rule: input.rule.trim(),
        source: input.source ?? null,
      }
      const problem = proposalProblem(item)
      if (problem !== null)
        return yield* T.fail(
          Invalid({
            message: problem === 'forbidden' ? FORBIDDEN_PROPOSAL_MESSAGE : problemMessage(problem),
          }),
        )
      const place = input.place ?? null
      yield* T.catchTag('NotFound', () => T.fail(Invalid({ message: PLACE_NOT_JOINED })))(
        requireChannelOf(memberId, place),
      )
      const origin = yield* originOf(memberId, input.rewriteOf ?? null)
      yield* run(sql`UPDATE members SET event_seq = event_seq WHERE id = ${memberId}`)
      const waiting = yield* proposalRows(memberId)
      if (waiting.length >= PROPOSALS_PER_PERSON) return yield* T.fail(Conflict({ message: PROPOSALS_FULL }))
      const taken = [
        ...(yield* principlesOf(memberId)).map((each) => each.topic),
        ...waiting.map((each) => each.topic),
      ]
      if (taken.some((title) => isSameTitle(title, item.topic)))
        return yield* T.fail(Conflict({ message: TITLE_TAKEN }))
      const proposal: PrincipleProposal = {
        id: `prop_${env.random.identifier()}` as ProposalId,
        ...item,
        place,
        question: input.question?.trim() || null,
        origin,
        rewriteOf: input.rewriteOf ?? null,
        createdAt: env.clock.now(),
      }
      yield* run(
        insertInto('principle_proposals', {
          id: proposal.id,
          member_id: memberId,
          kind: proposal.kind,
          topic: proposal.topic,
          rule: proposal.rule,
          source: proposal.source,
          place: proposal.place,
          question: proposal.question,
          origin: proposal.origin,
          rewrite_of: proposal.rewriteOf,
          created_at: proposal.createdAt,
        }),
      )
      yield* announceProposals(memberId)
      return proposal
    }),
  )

/** The person's waiting proposals, oldest first: the order the chat made them in. */
export const openProposals = (memberId: MemberId): T.Task<PrincipleProposal[], never, RequestEnv> =>
  T.map((rows: ReadonlyArray<ProposalRow>) => rows.map(toProposal))(proposalRows(memberId))

/**
 * Saves one proposal as a principle, with the person's edits, by the same path and checks as a
 * principle they wrote. Only a person's own sign-in may: the route is `human`, and this checks again.
 */
export const acceptProposal = (
  caller: Caller,
  id: string,
  edits: ProposalEdits,
): T.Task<Principle, Invalid | Conflict | NotFound | Forbidden, RequestEnv> =>
  inTransaction(
    T.gen(function* () {
      yield* requirePerson(caller)
      const proposal = yield* ownProposal(caller.member.id, id)
      const principle = yield* createPrinciple(caller.member.id, {
        kind: edits.kind ?? proposal.kind,
        topic: edits.topic ?? proposal.topic,
        rule: edits.rule ?? proposal.rule,
        source: edits.source === undefined ? proposal.source : edits.source,
        place: edits.place === undefined ? proposal.place : edits.place,
        origin: proposal.origin === 'chat' ? 'chat' : proposal.origin === 'discard' ? 'discard' : 'edit',
      })
      yield* deleteProposal(caller.member.id, proposal.id)
      return principle
    }),
  )

/** Saves every named proposal as it stands, or none: one that cannot be saved names itself. */
export const acceptProposals = (
  caller: Caller,
  ids: ReadonlyArray<string>,
): T.Task<MyPrinciples, Invalid | Conflict | NotFound | Forbidden, RequestEnv> =>
  inTransaction(
    T.gen(function* () {
      yield* requirePerson(caller)
      for (const id of new Set(ids)) {
        const proposal = yield* ownProposal(caller.member.id, id)
        yield* T.mapError((failure: Invalid | Conflict | NotFound | Forbidden) => ({
          ...failure,
          message: `“${proposal.topic}”: ${failure.message}`,
        }))(acceptProposal(caller, id, {}))
      }
      return yield* myPrinciples(caller.member.id)
    }),
  )

export const discardProposal = (caller: Caller, id: string): T.Task<void, NotFound | Forbidden, RequestEnv> =>
  T.gen(function* () {
    yield* requirePerson(caller)
    const proposal = yield* ownProposal(caller.member.id, id)
    yield* deleteProposal(caller.member.id, proposal.id)
  })

export interface ProposalEdits {
  readonly kind?: PrincipleKind | undefined
  readonly topic?: string | undefined
  readonly rule?: string | undefined
  readonly source?: string | null | undefined
  readonly place?: PlaceName | undefined
}

const CHANNEL_AGENT_PROPOSES_NOTHING =
  'A channel’s agent proposes no principles: its managers teach it on its channel’s page.'
const PROPOSALS_FULL = `Your human has ${PROPOSALS_PER_PERSON} proposals waiting. Ask them to save or discard some in the web client first.`
/** Not NotFound, which a desk reads as the feature being switched off. */
const PLACE_NOT_JOINED = 'place must be a channel your human is in, or left out for everywhere.'
const TITLE_TAKEN = 'A principle or a proposal already has that title. Give this one another title.'

const requirePerson = (caller: Caller): T.Task<void, Forbidden> =>
  isHuman(caller) ? T.unit : T.fail(Forbidden({ message: 'Only a person can save or discard a proposal.' }))

const ownProposal = (memberId: MemberId, id: string): T.Task<PrincipleProposal, NotFound, RequestEnv> =>
  T.gen(function* () {
    const row = yield* first<ProposalRow>(
      sql`SELECT * FROM principle_proposals WHERE id = ${id} AND member_id = ${memberId}`,
    )
    if (row === null) return yield* T.fail(NotFound({ message: 'That proposal is no longer waiting.' }))
    return toProposal(row)
  })

const deleteProposal = (memberId: MemberId, id: ProposalId): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    yield* run(sql`DELETE FROM principle_proposals WHERE id = ${id} AND member_id = ${memberId}`)
    yield* announceProposals(memberId)
  })

/** A proposal from a draft must name one the person edited or discarded, in a conversation they are in. */
const originOf = (memberId: MemberId, noteId: string | null): T.Task<ProposalOrigin, Invalid, RequestEnv> =>
  T.gen(function* () {
    if (noteId === null) return 'chat'
    const outcome = yield* rewriteOutcome(memberId, noteId)
    if (outcome === null)
      return yield* T.fail(
        Invalid({
          message: 'rewriteOf must name a draft your human edited or discarded, from interview_material.',
        }),
      )
    return outcome === 'edited' ? 'edit' : 'discard'
  })

/** Tells the person's web clients that the proposals changed, without content: they read them again. */
const announceProposals = (memberId: MemberId): T.Task<void, never, RequestEnv> =>
  T.map((env: RequestEnv) => {
    env.outbox.push({ memberId, event: { seq: 0, at: env.clock.now(), body: { type: 'proposals.changed' } } })
  })(T.ask<RequestEnv>())

const proposalRows = (memberId: MemberId): T.Task<ReadonlyArray<ProposalRow>, never, RequestEnv> =>
  all<ProposalRow>(
    sql`SELECT * FROM principle_proposals WHERE member_id = ${memberId} ORDER BY created_at, id`,
  )

interface ProposalRow {
  readonly id: ProposalId
  readonly kind: PrincipleKind
  readonly topic: string
  readonly rule: string
  readonly source: string | null
  readonly place: string | null
  readonly question: string | null
  readonly origin: ProposalOrigin
  readonly rewrite_of: PrincipleProposal['rewriteOf']
  readonly created_at: number
}

const toProposal = (row: ProposalRow): PrincipleProposal => ({
  id: row.id,
  kind: row.kind,
  topic: row.topic,
  rule: row.rule,
  source: row.source,
  place: row.place,
  question: row.question,
  origin: row.origin,
  rewriteOf: row.rewrite_of,
  createdAt: Number(row.created_at),
})
