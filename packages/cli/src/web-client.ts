import { Task as T } from '@homingbird/kernel'
import type { ConversationId } from '@homingbird/protocol'
import type { CliEnv } from './environment.ts'

export const webClientLink = (serverUrl: string, conversationId: ConversationId | null): string => {
  const base = serverUrl.replace(/\/+$/, '')
  return conversationId === null ? `${base}/` : `${base}/#/c/${conversationId}`
}

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
