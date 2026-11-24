import { Task as T } from '@homingbird/kernel'
import {
  type AsRead,
  PROPOSALS_SAVED_ONLY_BY_A_PERSON,
  ProposalInput,
  teachingMaterialText,
} from '@homingbird/protocol'
import type { CliEnv } from '../environment.ts'
import { type CliFailure, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { calling, openSession } from '../session.ts'

/** What a teaching chat draws on, every text in it quoted through wrapNote. */
export const teaching: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
  const { api } = yield* openSession
  const material: AsRead.TeachingMaterial = yield* calling(api['teaching.material']({}))
  return outcome(
    {
      document: material.document !== null,
      rewrites: material.rewrites.map((rewrite) => rewrite.noteId),
      taught: material.taught,
      proposed: material.proposed,
      room: material.room,
    },
    teachingMaterialText(material, env.nonce),
  )
})

/** Proposes a principle for the person to save in the web client; nothing here can save one. */
export const propose = (input: ProposalWords): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const decoded = ProposalInput.decode({
      topic: input.topic,
      rule: input.rule,
      ...(input.kind !== null && { kind: input.kind }),
      ...(input.source !== null && { source: input.source }),
      ...(input.place !== null && { place: input.place }),
      ...(input.question !== null && { question: input.question }),
      ...(input.rewriteOf !== null && { rewriteOf: input.rewriteOf }),
    })
    if (decoded._tag === 'Err')
      return yield* T.fail(
        failed(
          'A proposal needs a title without colons, semicolons or line breaks, one line of rule, and an https:// source if any.',
        ),
      )
    const { api } = yield* openSession
    const proposal = yield* calling(api['principleProposals.create']({ body: decoded.value }))
    return outcome(
      { proposed: proposal.id, topic: proposal.topic },
      `Proposed "${proposal.topic}" (${proposal.id}). It waits in Homingbird under Nest, Teaching, Teach by chatting. ${PROPOSALS_SAVED_ONLY_BY_A_PERSON}`,
    )
  })

export interface ProposalWords {
  readonly topic: string
  readonly rule: string
  readonly kind: string | null
  readonly source: string | null
  readonly place: string | null
  readonly question: string | null
  readonly rewriteOf: string | null
}
