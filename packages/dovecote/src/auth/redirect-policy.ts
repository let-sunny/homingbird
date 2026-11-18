export const isAllowedRedirectUri = (uri: string, allowedHosts: ReadonlyArray<string>): boolean =>
  isAcceptableRedirectUri(uri) &&
  (new URL(uri).protocol !== 'https:' || allowedHosts.includes(new URL(uri).hostname))

export const isAcceptableRedirectUri = (uri: string): boolean => {
  if (!URL.canParse(uri) || uri.includes('#')) return false
  const { protocol, hostname, username, password } = new URL(uri)
  if (username !== '' || password !== '') return false
  if (protocol === 'https:') return hostname !== ''
  if (protocol === 'http:') return isLoopbackHost(hostname)
  return !FORBIDDEN_REDIRECT_SCHEMES.has(protocol)
}

export const matchingRedirectUri = (registered: ReadonlyArray<string>, requested: string): string | null => {
  if (registered.includes(requested)) return requested
  return registered.some((candidate) => isSameLoopbackRedirect(candidate, requested)) ? requested : null
}

export const isLoopbackHost = (hostname: string): boolean => LOOPBACK_HOSTS.includes(hostname)

const LOOPBACK_HOSTS: ReadonlyArray<string> = ['localhost', '127.0.0.1', '[::1]']

const FORBIDDEN_REDIRECT_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:'])

const isSameLoopbackRedirect = (registered: string, requested: string): boolean => {
  if (!isAcceptableRedirectUri(requested) || !isAcceptableRedirectUri(registered)) return false
  const left = new URL(registered)
  const right = new URL(requested)
  return (
    left.protocol === 'http:' &&
    right.protocol === 'http:' &&
    left.hostname === right.hostname &&
    left.pathname === right.pathname &&
    left.search === right.search
  )
}
