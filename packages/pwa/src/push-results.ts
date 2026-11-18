import { strings } from './strings.ts'

export interface PushResult {
  readonly endpointHost: string
  readonly status: number
  readonly removed: boolean
}

/** One line per subscription for "Send a test notification": what the browser's push service answered. */
export const pushResultLines = (results: ReadonlyArray<PushResult>): string[] =>
  results.length === 0
    ? [strings.testPushNoDevices]
    : results.map((result) =>
        result.status >= 200 && result.status < 300
          ? strings.testPushSent({ host: result.endpointHost })
          : result.status === 0
            ? strings.testPushUnreachable({ host: result.endpointHost })
            : result.removed
              ? strings.testPushGone({ host: result.endpointHost, status: String(result.status) })
              : strings.testPushRefused({ host: result.endpointHost, status: String(result.status) }),
      )

/** Whether a subscription was made for this server's key, so enabling twice reuses it instead of adding one. */
export const isSameKey = (stored: ArrayBuffer | null, serverKey: Uint8Array): boolean => {
  if (stored === null || stored.byteLength !== serverKey.byteLength) return false
  const bytes = new Uint8Array(stored)
  return bytes.every((byte, index) => byte === serverKey[index])
}
