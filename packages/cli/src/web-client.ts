import { Task as T } from '@homingbird/kernel'
import type { Api, ConversationId, MemberId } from '@homingbird/protocol'
import type { CliEnv } from './environment.ts'

export const webClientLink = (serverUrl: string, conversationId: ConversationId | null): string => {
  const base = serverUrl.replace(/\/+$/, '')
  return conversationId === null ? `${base}/` : `${base}/#/c/${conversationId}`
}

/** Where a channel's managers review its agent's answers, which no conversation shows them. */
export const reviewLink = (serverUrl: string, slug: string): string =>
  `${serverUrl.replace(/\/+$/, '')}/#/channel/${encodeURIComponent(slug)}/agent`

/** The channel whose agent this credential is, or null for a person's own agent or when it cannot be read. */
export const reviewChannelOf = (
  api: Api,
  member: { readonly id: MemberId; readonly kind: string },
): T.Task<string | null> =>
  member.kind !== 'channel_agent'
    ? T.succeed(null)
    : T.catchAll(() => T.succeed(null))(
        T.map(
          (listed: {
            readonly channels: ReadonlyArray<{
              readonly slug: string
              readonly agent?: { readonly id: string } | null
            }>
          }) => listed.channels.find((channel) => channel.agent?.id === member.id)?.slug ?? null,
        )(api['channels.list']({ query: { limit: '100' } })),
      )

export const openOnServer = (url: string, serverUrl: string): T.Task<boolean, never, CliEnv> =>
  T.flatMap((env: CliEnv) =>
    isWithin(serverUrl, url)
      ? T.catchAll(() => T.succeed(false))(
          T.tryPromise(
            () => env.launcher.openInBrowser(url),
            () => 'not opened' as const,
          ),
        )
      : T.succeed(false),
  )(T.ask<CliEnv>())

export const isWithin = (serverUrl: string, url: string): boolean => {
  if (!URL.canParse(serverUrl) || !URL.canParse(url)) return false
  const [server, target] = [new URL(serverUrl), new URL(url)]
  return (target.protocol === 'https:' || target.protocol === 'http:') && target.origin === server.origin
}
