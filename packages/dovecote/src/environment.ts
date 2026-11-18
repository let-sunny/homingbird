import type { HasClock, Task as T } from '@homingbird/kernel'
import type { CredentialId, CredentialKind, Member, MemberId, StreamEvent } from '@homingbird/protocol'
import type { ClientMetadataDocuments } from './auth/client-metadata.ts'
import type { IdentityProvider } from './auth/identity-provider.ts'
import type { Config } from './config.ts'
import type { AuditRecord } from './domain/audit.ts'
import type { Hub } from './events/hub.ts'
import type { RateLimiter } from './http/rate-limiter.ts'
import type { PushOutcome } from './push/notifier.ts'
import type { Random } from './random.ts'
import type { HasSql } from './sql/database.ts'

export interface AppEnv extends HasSql, HasClock {
  readonly config: Config
  readonly random: Random
  readonly hub: Hub
  readonly identityProvider: IdentityProvider
  readonly clientMetadata: ClientMetadataDocuments
  readonly rateLimiter: RateLimiter
  readonly auditSink: (record: AuditRecord) => void
  readonly pushSink: (memberId: MemberId, event: StreamEvent) => void
  readonly pushTest: (memberId: MemberId) => T.Task<ReadonlyArray<PushOutcome>, never, AppEnv>
  readonly log: (line: string) => void
}

export interface Caller {
  readonly member: Member
  readonly credential: {
    readonly id: CredentialId
    readonly kind: CredentialKind
    readonly name: string
  }
}

export const isHuman = (caller: Caller): boolean => caller.credential.kind === 'human'
