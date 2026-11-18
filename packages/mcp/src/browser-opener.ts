import { Task as T } from '@homingbird/kernel'

export type Launch = (argv: ReadonlyArray<string>) => Promise<void>

export type OpenInBrowser = (url: string) => T.Task<boolean>

export const browserOpener =
  (launch: Launch, platform: string, serverUrl: string): OpenInBrowser =>
  (url) =>
    isWithin(serverUrl, url)
      ? T.catchAll(() => T.succeed(false))(
          T.tryPromise(
            async () => {
              await launch(openerCommand(platform, url))
              return true
            },
            () => 'not opened' as const,
          ),
        )
      : T.succeed(false)

export const openerCommand = (platform: string, url: string): string[] =>
  platform === 'darwin'
    ? ['open', url]
    : platform === 'win32'
      ? ['rundll32', 'url.dll,FileProtocolHandler', url]
      : ['xdg-open', url]

export const isWithin = (serverUrl: string, url: string): boolean => {
  if (!URL.canParse(serverUrl) || !URL.canParse(url)) return false
  const [server, target] = [new URL(serverUrl), new URL(url)]
  return (target.protocol === 'https:' || target.protocol === 'http:') && target.origin === server.origin
}
