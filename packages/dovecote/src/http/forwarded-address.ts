export const clientAddressOf = (
  forwardedFor: string | undefined,
  socketAddress: string | undefined,
  trustedProxies: number,
): string => {
  const socket = socketAddress ?? 'unknown'
  if (trustedProxies === 0) return socket
  const hops = (forwardedFor ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  // Each proxy appends the address it saw; anything left of what the trusted proxies added came from the client.
  const [address] = hops.slice(Math.max(0, hops.length - trustedProxies))
  return address ?? socket
}
