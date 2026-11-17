import { Task as T } from '@homingbird/kernel'
import { readCredential } from '../credentials.ts'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { calling, openSession } from '../session.ts'
import { drafts } from './drafting.ts'
import { conversations, inbox } from './reading.ts'

export const overview: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  if ((yield* readCredential('agent')) === null) return outcome({ signedIn: false }, 'Not signed in.')
  const { api, credential } = yield* openSession('agent')
  const me = yield* calling(api['me.get']({}))
  const parts = yield* T.struct({ conversations, awaiting: inbox(false), drafts })
  const hasApproveButton = (yield* readCredential('approval')) !== null
  return outcome(
    {
      signedIn: true,
      server: credential.serverUrl,
      member: { id: me.member.id, name: me.member.name, email: me.member.email },
      hasApproveButton,
      ...(parts.conversations.json as object),
      awaiting: (parts.awaiting.json as { items: unknown }).items,
      ...(parts.drafts.json as object),
    },
    [
      `Signed in as ${me.member.name} on ${credential.serverUrl}`,
      '',
      'Conversations',
      parts.conversations.text,
      '',
      'Waiting for a reply',
      parts.awaiting.text,
      '',
      'Drafts waiting for approval',
      parts.drafts.text,
    ].join('\n'),
  )
})
