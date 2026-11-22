import { Task as T } from '@homingbird/kernel'
import {
  type AutoSend,
  type ConversationId,
  type MemberId,
  NotFound,
  type Principle,
  type PrincipleCounts,
  type PrincipleId,
  type PrincipleKind,
  type PrincipleOrigin,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all } from '../sql/database.ts'
import { list, sql } from '../sql/query.ts'
import { featureIsOn } from './settings.ts'

/** A member's principles in their order, each with what became of the drafts that applied it. */
export const principlesOf = (memberId: MemberId): T.Task<CountedPrinciple[], never, AppEnv> =>
  T.gen(function* () {
    const rows = yield* all<PrincipleRow>(
      sql`SELECT * FROM principles WHERE member_id = ${memberId} ORDER BY position, created_at, id`,
    )
    if (rows.length === 0) return []
    const ids = list(rows.map((row) => row.id))
    const applications = yield* all<ApplicationRow>(sql`
      SELECT a.principle_id, n.status, n.origin, n.decided_at, a.missed_at, n.auto_principle_id
      FROM principle_applications a JOIN notes n ON n.id = a.note_id AND n.debate_id IS NULL
      WHERE a.principle_id IN ${ids}`)
    const places = yield* all<{ principle_id: PrincipleId; conversation_id: ConversationId }>(sql`
      SELECT principle_id, conversation_id FROM principle_auto_send_places
      WHERE principle_id IN ${ids} ORDER BY conversation_id`)
    const byPrinciple = Map.groupBy(applications, (application) => application.principle_id)
    const placesOf = Map.groupBy(places, (place) => place.principle_id)
    return rows.map((row) =>
      toPrinciple(
        row,
        byPrinciple.get(row.id) ?? [],
        (placesOf.get(row.id) ?? []).map((place) => place.conversation_id),
      ),
    )
  })

/**
 * A principle as the server keeps it, always with its counts and its automatic sending; the person sees
 * the counts only with agent figures on, and the switch only while the organization allows it.
 */
export type CountedPrinciple = Principle & { readonly counts: PrincipleCounts; readonly autoSend: AutoSend }

export const ownPrinciple = (memberId: MemberId, id: string): T.Task<CountedPrinciple, NotFound, AppEnv> =>
  T.gen(function* () {
    const found = (yield* principlesOf(memberId)).find((principle) => principle.id === id)
    if (found === undefined) return yield* T.fail(NotFound({ message: 'No such principle.' }))
    return found
  })

export const shownWith = (
  principle: CountedPrinciple,
  shown: { readonly figures: boolean; readonly autoSend: boolean },
): Principle => {
  const { autoSend, counts, ...rest } = principle
  const { autoSent, ...decided } = counts
  return {
    ...rest,
    counts: shown.figures ? (shown.autoSend ? counts : decided) : null,
    ...(shown.autoSend && { autoSend }),
  }
}

export const withFigures = (principle: CountedPrinciple): T.Task<Principle, never, AppEnv> =>
  T.map((shown: PrincipleShown) => shownWith(principle, shown))(principleShown)

/** What of a principle the organization shows its person: the counts, and the automatic sending switch. */
export const principleShown: T.Task<PrincipleShown, never, AppEnv> = T.gen(function* () {
  return { figures: yield* featureIsOn('agentFigures'), autoSend: yield* featureIsOn('autoSend') }
})

export interface PrincipleShown {
  readonly figures: boolean
  readonly autoSend: boolean
}

interface PrincipleRow {
  readonly id: PrincipleId
  readonly member_id: MemberId
  readonly kind: PrincipleKind
  readonly topic: string
  readonly rule: string
  readonly source: string | null
  readonly place: string | null
  readonly enabled: number
  readonly origin: PrincipleOrigin
  readonly position: number
  readonly created_at: number
  readonly updated_at: number
  readonly last_applied_at: number | null
  readonly public_text: string | null
  readonly auto_send: number | null
}

interface ApplicationRow {
  readonly principle_id: PrincipleId
  readonly status: string
  readonly origin: string
  readonly decided_at: number | null
  readonly missed_at: number | null
  readonly auto_principle_id: string | null
}

const toPrinciple = (
  row: PrincipleRow,
  applications: ReadonlyArray<ApplicationRow>,
  places: ReadonlyArray<ConversationId>,
): CountedPrinciple => ({
  id: row.id,
  kind: row.kind,
  topic: row.topic,
  rule: row.rule,
  source: row.source,
  place: row.place,
  enabled: Number(row.enabled) === 1,
  origin: row.origin,
  position: Number(row.position),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
  lastAppliedAt: row.last_applied_at === null ? null : Number(row.last_applied_at),
  publicText: row.public_text,
  counts: {
    applied: applications.length,
    sentAsWritten: applications.filter(
      (each) => each.status === 'sent' && each.origin === 'agent' && each.auto_principle_id === null,
    ).length,
    edited: applications.filter((each) => each.status === 'sent' && each.origin !== 'agent').length,
    discarded: applications.filter((each) => each.status === 'discarded' && each.decided_at !== null).length,
    missed: applications.filter((each) => each.missed_at !== null).length,
    autoSent: applications.filter((each) => each.status === 'sent' && each.auto_principle_id === row.id)
      .length,
  },
  autoSend: { enabled: Number(row.auto_send ?? 0) === 1, places },
})
