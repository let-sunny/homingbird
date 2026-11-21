import { Schema as S } from '@homingbird/kernel'
import { MemberId } from './ids.ts'

export const INVITE_LIFETIME_SECONDS = 7 * 24 * 60 * 60

/** A pending invite as its maker and administrators see it; only the response that makes one carries its link. */
export const Invite = S.struct({
  id: S.string(),
  email: S.nullable(S.string({ maxLength: 320 })),
  createdBy: MemberId,
  createdAt: S.int({ min: 0 }),
  expiresAt: S.int({ min: 0 }),
})
export type Invite = S.Infer<typeof Invite>

export const InviteLink = S.struct({ invite: Invite, url: S.string() })
export type InviteLink = S.Infer<typeof InviteLink>

export const InviteEmail = S.string({ minLength: 3, maxLength: 320, pattern: /^[^\s@]+@[^\s@]+$/ })
