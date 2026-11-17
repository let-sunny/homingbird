import type { HasClock } from '@homingbird/kernel'
import type { CredentialId, CredentialKind, Member } from '@homingbird/protocol'
import type { Config } from './config.ts'
import type { Hub } from './events/hub.ts'
import type { IdentityProvider } from './auth/identity-provider.ts'
import type { Random } from './random.ts'
import type { HasSql } from './sql/database.ts'

export interface AppEnv extends HasSql, HasClock {
  readonly config: Config
  readonly random: Random
  readonly hub: Hub
  readonly identityProvider: IdentityProvider
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
