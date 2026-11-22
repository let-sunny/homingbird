import type { HasClock, Task as T } from '@homingbird/kernel'
import type {
  Conflict,
  CredentialId,
  CredentialKind,
  DeskUnavailableKind,
  DeskWakeTest,
  Member,
  MemberId,
  NotFound,
  StreamEvent,
} from '@homingbird/protocol'
import type { AnalyticsForwarder } from './analytics/forward.ts'
import type { ClientMetadataDocuments } from './auth/client-metadata.ts'
import type { IdentityProvider } from './auth/identity-provider.ts'
import type { Config } from './config.ts'
import type { TurnHolds } from './domain/debate-turn-holds.ts'
import type { AttemptWindows } from './domain/denied-attempts.ts'
import type { Hub } from './events/hub.ts'
import type { RateLimiter } from './http/rate-limiter.ts'
import type { Log } from './log/operational-log.ts'
import type { PushOutcome } from './push/notifier.ts'
import type { Random } from './random.ts'
import type { SlackApi } from './slack/slack-web-api.ts'
import type { HasSql } from './sql/database.ts'

export interface AppEnv extends HasSql, HasClock {
  readonly config: Config
  readonly random: Random
  readonly hub: Hub
  readonly identityProvider: IdentityProvider
  readonly clientMetadata: ClientMetadataDocuments
  readonly rateLimiter: RateLimiter
  readonly attempts: AttemptWindows
  readonly turnHolds: TurnHolds
  readonly analytics: AnalyticsForwarder
  readonly pushSink: (memberId: MemberId, event: StreamEvent, isNewReview: boolean) => void
  readonly pushTest: (memberId: MemberId) => T.Task<ReadonlyArray<PushOutcome>, never, AppEnv>
  readonly pushDeskUnavailable: (memberId: MemberId, kind: DeskUnavailableKind) => T.Task<void, never, AppEnv>
  readonly wakeSink: (memberId: MemberId, event: StreamEvent) => void
  readonly wakeTest: (memberId: MemberId) => T.Task<DeskWakeTest, NotFound | Conflict, AppEnv>
  readonly slack: SlackApi | null
  readonly log: Log
  readonly requestId: string | null
  readonly client: RequestClient | null
}

export interface RequestClient {
  readonly address: string
  readonly userAgent: string
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

/**
 * The caller as visibility rules read them: an administrator sees private rooms only through their own
 * sign-in, never through an agent credential, which reads as an ordinary member (rule 6).
 */
export const viewerOf = (caller: Caller): Member =>
  isHuman(caller) ? caller.member : { ...caller.member, role: 'member' }
