import { Task as T } from '@homingbird/kernel'
import { type LeaverFacts, leaverFactsFor } from './domain/leaver-facts.ts'
import type { AppEnv } from './environment.ts'
import { requireCurrentSchema } from './sql/schema.ts'

/**
 * `dovecote members verify-left <email>` on the server host: each offboarding check the deployment guide
 * lists, passed or failed. Answers 0 when every check passes and 1 when one fails or nobody has the email.
 */
export const runMembersCommand = (
  args: ReadonlyArray<string>,
  write: (line: string) => void,
): T.Task<number, never, AppEnv> =>
  T.gen(function* () {
    const schema = yield* T.result(requireCurrentSchema)
    if (schema._tag === 'Err') {
      write(schema.error.message)
      return 3
    }
    const [command, email, ...rest] = args
    if (command !== 'verify-left' || email === undefined || rest.length > 0) {
      write(USAGE)
      return 2
    }
    const facts = yield* leaverFactsFor(email)
    if (facts === null) {
      write(`No person has the email ${email}.`)
      return 1
    }
    const checks = offboardingChecks(facts)
    write(`Offboarding checks for ${facts.email} (${facts.id}):`)
    for (const check of checks) write(`  ${check.passed ? 'pass' : 'FAIL'}  ${check.text}`)
    const failed = checks.filter((check) => !check.passed).length
    write(failed === 0 ? 'Every check passes.' : `${failed} of ${checks.length} checks fail.`)
    return failed === 0 ? 0 : 1
  })

/** The checks, in the order the deployment guide's offboarding list gives them, each saying what it found. */
export const offboardingChecks = (facts: LeaverFacts): ReadonlyArray<OffboardingCheck> => [
  {
    passed: facts.status === 'deactivated',
    text: facts.status === 'deactivated' ? 'Deactivated' : `Deactivated: the member is ${facts.status}`,
  },
  {
    passed: facts.ownCredentials === 0,
    text: `No working credential of their own, browser or agent${found(facts.ownCredentials, 'still works', 'still work')}`,
  },
  {
    passed: facts.issuedCredentials === 0,
    text: `No working credential they issued to a channel's agent${found(facts.issuedCredentials, 'still works', 'still work')}`,
  },
  {
    passed: facts.groups === 0,
    text: `In no group, so managing no channel${found(facts.groups, 'group', 'groups')}`,
  },
  {
    passed: facts.approvedSignIns === 0,
    text: `No approved sign-in waiting for a program${found(facts.approvedSignIns, 'waits', 'wait')}`,
  },
  {
    passed: facts.deskWakes === 0,
    text: `No cloud desk wake address${found(facts.deskWakes, 'is saved', 'are saved')}`,
  },
  {
    passed: !facts.namedAdministrator,
    text: facts.namedAdministrator
      ? 'Not named in HB_ADMIN_EMAILS: remove them from it and restart Dovecote'
      : 'Not named in HB_ADMIN_EMAILS',
  },
]

export interface OffboardingCheck {
  readonly passed: boolean
  readonly text: string
}

const found = (count: number, one: string, other: string): string =>
  count === 0 ? '' : `: ${count} ${count === 1 ? one : other}`

const USAGE = 'Usage: dovecote members verify-left <email>'
