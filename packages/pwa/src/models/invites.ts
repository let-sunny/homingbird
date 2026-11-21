import type { AsRead } from '@homingbird/protocol'
import { featureOn } from '../features.ts'
import { formats, strings } from '../strings.ts'

/**
 * "Invite people": the form that makes an invite link, the link just made with its copy button, and the
 * invites still waiting, newest first, each with when it stops working and a button to revoke it.
 */
export const invitesModel = (input: InvitesInput): InvitesModel => ({
  title: strings.invites.title,
  intro: strings.invites.intro,
  email: { label: strings.invites.email, hint: strings.invites.emailHint },
  create: input.making.kind === 'creating' ? strings.invites.creating : strings.invites.create,
  busy: input.making.kind === 'creating',
  problem: input.making.kind === 'failed' ? strings.invites.failed : null,
  made: madeModel(input.making),
  pendingTitle: strings.invites.pending,
  pending:
    input.pending === null
      ? null
      : [...input.pending]
          .filter((invite) => invite.expiresAt > input.now)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((invite) => ({
            id: invite.id,
            who: invite.email ?? strings.invites.anyone,
            expires: strings.invites.expires({ date: formats.full.format(new Date(invite.expiresAt)) }),
            revoke: strings.invites.revoke,
          })),
  none: strings.invites.none,
})

/**
 * Where "Invite people" appears: in Administration → Members for an administrator, and on People for
 * a member the organization lets invite. Never where the server has invites off.
 */
export const showsInvites = (
  where: 'admin' | 'people',
  me: Pick<AsRead.Me, 'member' | 'canInvite'>,
  info: AsRead.ServerInfo | null,
): boolean =>
  featureOn('invites', info) && me.canInvite === true && (where === 'admin') === (me.member.role === 'admin')

/** The address typed to bind an invite to, or null for an invite anyone may use. */
export const emailToBind = (typed: string): string | null => typed.trim().toLowerCase() || null

export type InviteMaking =
  | { readonly kind: 'idle' }
  | { readonly kind: 'creating' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'made'
      readonly link: AsRead.InviteLink
      readonly copied: 'not yet' | 'copied' | 'refused'
    }

export interface InvitesInput {
  readonly making: InviteMaking
  readonly pending: ReadonlyArray<AsRead.Invite> | null
  readonly now: number
}

export interface InvitesModel {
  readonly title: string
  readonly intro: string
  readonly email: { readonly label: string; readonly hint: string }
  readonly create: string
  readonly busy: boolean
  readonly problem: string | null
  readonly made: {
    readonly url: string
    readonly explanation: string
    readonly copy: string
    readonly copyProblem: string | null
  } | null
  readonly pendingTitle: string
  readonly pending: ReadonlyArray<{
    readonly id: string
    readonly who: string
    readonly expires: string
    readonly revoke: string
  }> | null
  readonly none: string
}

const madeModel = (making: InviteMaking): InvitesModel['made'] => {
  if (making.kind !== 'made') return null
  const email = making.link.invite.email
  return {
    url: making.link.url,
    explanation: email === null ? strings.invites.made : strings.invites.madeFor({ email }),
    copy: making.copied === 'copied' ? strings.invites.copied : strings.invites.copy,
    copyProblem: making.copied === 'refused' ? strings.invites.copyFailed : null,
  }
}
