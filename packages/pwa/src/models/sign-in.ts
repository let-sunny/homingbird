import { signInHref } from '../routes.ts'
import { strings } from '../strings.ts'
import type { PipState } from '../views/pip.ts'
import { wordmark } from './branding.ts'

/**
 * The page shown while nobody is signed in: a welcome, why the person was signed out, or an invite to
 * accept by signing in, which posts the link's code rather than putting it in an address.
 */
export const signInModel = (input: SignInInput): SignInModel => {
  const label = strings.signInWith({ provider: input.signInWith ?? '…' })
  if (input.invite !== null && input.refusal === null)
    return {
      title: strings.invites.invitedTitle,
      pip: 'sign-in',
      wordmark: wordmark(input.brandingName),
      tagline: strings.invites.invitedBody({ name: wordmark(input.brandingName) }),
      refusal: null,
      signIn: { kind: 'invite', action: INVITE_ACTION, code: input.invite, label },
    }
  return {
    title: input.refusal === null ? strings.welcome : strings.signedOutTitle,
    pip: input.refusal === null ? 'sign-in' : 'failed',
    wordmark: wordmark(input.brandingName),
    tagline: strings.tagline,
    refusal: input.refusal,
    signIn: { kind: 'link', href: signInHref(input.hash), label },
  }
}

export interface SignInInput {
  readonly refusal: string | null
  /** The code of the invite link the page was opened from. */
  readonly invite: string | null
  readonly brandingName: string
  readonly signInWith: string | null
  readonly hash: string
}

export interface SignInModel {
  readonly title: string
  readonly pip: PipState
  readonly wordmark: string
  readonly tagline: string
  readonly refusal: string | null
  readonly signIn:
    | { readonly kind: 'link'; readonly href: string; readonly label: string }
    | { readonly kind: 'invite'; readonly action: string; readonly code: string; readonly label: string }
}

const INVITE_ACTION = '/auth/invite'
