import type { ContactMode, CredentialKind, MemberStatus, Relation } from './model.ts'

export interface MessagingFacts {
  readonly mode: ContactMode
  readonly isSelf: boolean
  readonly recipientStatus: MemberStatus
  readonly blocked: boolean
  readonly contact: boolean
}

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
