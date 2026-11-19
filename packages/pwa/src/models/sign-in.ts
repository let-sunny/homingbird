import { signInHref } from '../routes.ts'
import { strings } from '../strings.ts'
import type { PipState } from '../views/pip.ts'
import { wordmark } from './branding.ts'

/** The page shown while nobody is signed in: a welcome, or why the person was signed out. */
export const signInModel = (input: SignInInput): SignInModel => ({
  title: input.refusal === null ? strings.welcome : strings.signedOutTitle,
  pip: input.refusal === null ? 'sign-in' : 'failed',
  wordmark: wordmark(input.brandingName),
  tagline: strings.tagline,
  refusal: input.refusal,
  signIn: {
    href: signInHref(input.hash),
    label: strings.signInWith({ provider: input.signInWith ?? '…' }),
  },
})

export interface SignInInput {
  readonly refusal: string | null
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
  readonly signIn: { readonly href: string; readonly label: string }
}
