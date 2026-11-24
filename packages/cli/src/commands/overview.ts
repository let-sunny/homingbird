import { Task as T } from '@homingbird/kernel'
import { ConversationId } from '@homingbird/protocol'
import { answeringFlowFor } from '../answering-flow.ts'
import { readCredential } from '../credentials.ts'
import type { CliEnv } from '../environment.ts'
import { type CliFailure, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { calling, openSession } from '../session.ts'
import { reviewChannelOf, reviewLink } from '../web-client.ts'
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
  const reviewChannel = yield* reviewChannelOf(api, me.member)
  return outcome(
    {
      signedIn: true,
      server: credential.serverUrl,
      member: { id: me.member.id, name: me.member.name, email: me.member.email, kind: me.member.kind },
      ...(reviewChannel !== null && {
        reviewChannel,
        reviewLink: reviewLink(credential.serverUrl, reviewChannel),
      }),
      ...(parts.conversations.json as object),
      awaiting: (parts.awaiting.json as { items: unknown }).items,
      ...(parts.drafts.json as object),
      answeringFlow,
    },
    [
      `Signed in as ${me.member.name} on ${credential.serverUrl}`,
      '',
      'Direct notes and channels',
      parts.conversations.text,
      '',
      'Waiting for a reply',
      parts.awaiting.text,
      '',
      reviewChannel === null
        ? 'Drafts waiting for approval'
        : `Drafts waiting for the managers of #${reviewChannel}`,
      parts.drafts.text,
      ...(reviewChannel === null
        ? []
        : ['', `They review them at ${reviewLink(credential.serverUrl, reviewChannel)}`]),
    ].join('\n'),
  )
})

/** What a desk adds to its instructions for a draft in one conversation: that channel's principles come first. */
export const guidance = (rawId: string): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const conversationId = ConversationId.decode(rawId)
    if (conversationId._tag === 'Err') return yield* T.fail(failed('That is not a conversation id.'))
    const { api } = yield* openSession
    const text = yield* answeringFlowFor(api, conversationId.value)
    return outcome({ guidance: text }, text === '' ? 'No answering flow or principles apply here.' : text)
  })
