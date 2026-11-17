/**
 * Who may message whom, and what each kind of credential may do. Pure decisions; the server
 * gathers the facts and asks here.
 */
import type { ContactMode, CredentialKind, MemberStatus, Relation } from './model.ts'

export interface MessagingFacts {
  readonly mode: ContactMode
  readonly isSelf: boolean
  readonly recipientStatus: MemberStatus
  /** Either side has blocked the other. */
  readonly blocked: boolean
  /** A contact request between the two has been accepted. */
  readonly contact: boolean
}

/** Blocking wins in both modes. `contacts` mode additionally needs an accepted contact. */
export const canMessage = (facts: MessagingFacts): boolean =>
  !facts.isSelf &&
  facts.recipientStatus === 'active' &&
  !facts.blocked &&
  (facts.mode === 'open' || facts.contact)

export interface RelationFacts {
  readonly isSelf: boolean
  readonly blockedByViewer: boolean
  readonly contact: 'accepted' | 'request_sent' | 'request_received' | null
}

export const relation = (facts: RelationFacts): Relation =>
  facts.isSelf
    ? 'self'
    : facts.blockedByViewer
      ? 'blocked'
      : facts.contact === 'accepted'
        ? 'contact'
        : (facts.contact ?? 'none')

/**
 * What a route demands of the caller.
 *  - `public`: no credential
 *  - `member`: any valid credential, human or agent
 *  - `human`:  a human credential; an agent credential is refused
 *  - `admin`:  a human credential belonging to an admin
 */
export type Access = 'public' | 'member' | 'human' | 'admin'

export interface Caller {
  readonly kind: CredentialKind
  readonly role: 'member' | 'admin'
}

export const allows = (access: Access, caller: Caller | null): boolean => {
  if (access === 'public') return true
  if (caller === null) return false
  if (access === 'member') return true
  if (caller.kind !== 'human') return false
  return access === 'human' || caller.role === 'admin'
}
