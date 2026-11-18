import { Task as T } from '@homingbird/kernel'
import { answeringFlowFor } from '../answering-flow.ts'
import { readCredential } from '../credentials.ts'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { calling, openSession } from '../session.ts'
import { drafts } from './drafting.ts'
import { conversations, inbox } from './reading.ts'

export const overview: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
  if ((yield* readCredential) === null)
    return outcome(
      { signedIn: false, ...(env.server !== null && { server: env.server }) },
      env.server === null ? 'Not signed in.' : `Not signed in to ${env.server}.`,
    )
  const { api, credential } = yield* openSession
  const me = yield* calling(api['me.get']({}))
  const parts = yield* T.struct({ conversations, awaiting: inbox(false), drafts })
  const answeringFlow = yield* answeringFlowFor(api)
  return outcome(
    {
      signedIn: true,
      server: credential.serverUrl,
      member: { id: me.member.id, name: me.member.name, email: me.member.email },
      ...(parts.conversations.json as object),
      awaiting: (parts.awaiting.json as { items: unknown }).items,
      ...(parts.drafts.json as object),
      answeringFlow,
    },
    [
      `Signed in as ${me.member.name} on ${credential.serverUrl}`,
      '',
      'Direct messages and channels',
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
