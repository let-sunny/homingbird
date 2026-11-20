import { Task as T } from '@homingbird/kernel'
import { type MemberId, NOTIFICATION_LEVELS } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { first, run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'

export type ChosenLevel = (typeof NOTIFICATION_LEVELS)[number]

/** Which conversations may push notifications to a person; someone who never chose gets all of them. */
export const notificationLevelOf = (memberId: MemberId): T.Task<ChosenLevel, never, AppEnv> =>
  T.map((row: { readonly notifications: string | null } | null) => levelIn(row?.notifications ?? null))(
    first<{ readonly notifications: string | null }>(
      sql`SELECT notifications FROM members WHERE id = ${memberId}`,
    ),
  )

export const setNotificationLevel = (
  memberId: MemberId,
  level: ChosenLevel,
): T.Task<{ readonly notifications: ChosenLevel }, never, AppEnv> =>
  T.as({ notifications: level })(
    run(sql`UPDATE members SET notifications = ${level === 'all' ? null : level} WHERE id = ${memberId}`),
  )

/** A stored level this server does not know reads as `all`, so a person never misses notes silently. */
export const levelIn = (stored: string | null): ChosenLevel =>
  NOTIFICATION_LEVELS.find((level) => level === stored) ?? 'all'
