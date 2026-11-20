import type { AsRead } from '@homingbird/protocol'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'

/**
 * The banner a person sees while none of their agent credentials can be used: a background service
 * started before its sign-in has no credential to reach the server with, so the server sees only that
 * no desk of theirs has connected. Null while the credentials load, and once one can be used.
 */
export const serviceBannerModel = (input: ServiceBannerInput): ServiceBannerModel | null => {
  if (input.credentials === null) return null
  if (input.credentials.some((credential) => isUsableAgent(credential, input.now))) return null
  return {
    title: strings.serviceBanner.title,
    body: strings.serviceBanner.body,
    command: `homingbird login --server ${input.origin}`,
    link: { href: hrefFor({ name: 'device', code: null }), label: strings.serviceBanner.enterCode },
  }
}

export interface ServiceBannerInput {
  readonly credentials: ReadonlyArray<AsRead.Credential> | null
  readonly origin: string
  readonly now: number
}

export interface ServiceBannerModel {
  readonly title: string
  readonly body: string
  readonly command: string
  readonly link: { readonly href: string; readonly label: string }
}

const isUsableAgent = (credential: AsRead.Credential, now: number): boolean =>
  credential.kind === 'agent' && credential.revokedAt === null && credential.expiresAt > now
