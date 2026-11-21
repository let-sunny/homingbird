import { Task as T } from '@homingbird/kernel'
import { type InviteRefused, openInvite } from '../auth/invites.ts'
import { type SignInRefused, beginSignIn, completeSignIn } from '../auth/sign-in.ts'
import { recordAudit } from '../domain/audit.ts'
import { authenticate, revokeByToken } from '../domain/credentials.ts'
import { featureIsOn } from '../domain/settings.ts'
import type { AppEnv } from '../environment.ts'
import { transact } from '../events/events.ts'
import { SAME_SITE_HEADER, sessionCookie, sessionToken } from './authenticate.ts'
import { type HttpRequest, type HttpResponse, formFields, noContent, redirect, text } from './exchange.ts'
import { LIMITS } from './rate-limiter.ts'

export const handleSignInRequest = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const route = `${request.method} ${request.path}`
    if (!env.rateLimiter.allow(`sign-in:${request.remoteAddress}`, LIMITS.signIn))
      return text(429, 'Too many sign-in attempts. Try again in a minute.')
    if (route === 'GET /auth/login') return yield* startSignIn(request)
    if (route === 'GET /auth/callback') return yield* finishSignIn(request)
    if (route === 'POST /auth/invite') return yield* startInvitedSignIn(request)
    if (route === 'POST /auth/logout') return yield* signOut(request)
    if (env.config.identity.devLogin && route === 'GET /auth/dev')
      return developmentForm(request, env.config.themeDirectory !== null)
    if (env.config.identity.devLogin && route === 'POST /auth/dev') return developmentSubmit(request)
    return text(404, 'Not found.')
  })

const startSignIn = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.fold(refusal, (url: string) => redirect(url))(beginSignIn(request.query.get('return_to') ?? undefined))

/**
 * An invite link opens the web client, which posts its code here, so the code stays out of request
 * lines and referrers. A valid invite starts the usual sign-in, carrying which invite it came from.
 */
const startInvitedSignIn = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (!(yield* featureIsOn('invites'))) return text(404, 'Not found.')
    if (!env.rateLimiter.allow(`invite:${request.remoteAddress}`, LIMITS.inviteOpen))
      return text(429, 'Too many invite links tried. Try again in a few minutes.')
    const opened = yield* T.result(openInvite(formFields(request).code ?? ''))
    if (opened._tag === 'Err') return inviteRefusal(opened.error)
    return yield* T.fold(refusal, (url: string) => redirect(url))(beginSignIn('/', opened.value))
  })

const finishSignIn = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const parameters = {
      ...(request.query.has('code') && { code: request.query.get('code')! }),
      ...(request.query.has('state') && { state: request.query.get('state')! }),
    }
    const session = yield* T.result(transact(completeSignIn(parameters, request.headers['user-agent'] ?? '')))
    if (session._tag === 'Err') {
      yield* transact(
        recordAudit('authn.sign_in_failed', { outcome: 'failed', detail: { reason: session.error.reason } }),
      )
      return refusal(session.error)
    }
    const maxAge = Math.floor((session.value.expiresAt - env.clock.now()) / 1000)
    return redirect(session.value.returnTo, {
      'set-cookie': sessionCookie(session.value.token, maxAge, env.config.publicUrl),
    })
  })

const signOut = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const token = sessionToken(request)
    if (token === null || request.headers[SAME_SITE_HEADER] !== '1') return noContent()
    const caller = yield* T.result(authenticate(token))
    yield* revokeByToken(token)
    if (caller._tag === 'Ok')
      yield* transact(
        recordAudit('authn.signed_out', {
          caller: caller.value,
          targetId: caller.value.member.id,
          detail: {},
        }),
      )
    return noContent({ 'set-cookie': sessionCookie('', 0, env.config.publicUrl) })
  })

const refusal = (refused: SignInRefused): HttpResponse =>
  refused.reason === 'invite_refused'
    ? inviteRefusal(refused)
    : redirect(`/#/signed-out?${new URLSearchParams({ reason: refused.message }).toString()}`)

/** Every refused invite lands on one page, which the web client explains in the person's language. */
const inviteRefusal = (_: InviteRefused | SignInRefused): HttpResponse => redirect('/#/invite-refused')

const developmentSubmit = (request: HttpRequest): HttpResponse => {
  const { email = '', name = '', state = '' } = formFields(request)
  const code = Buffer.from(JSON.stringify({ email, name })).toString('base64url')
  return redirect(`/auth/callback?${new URLSearchParams({ code, state }).toString()}`)
}

const developmentForm = (request: HttpRequest, isThemed: boolean): HttpResponse =>
  text(
    200,
    `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Development login</title>
<link rel="stylesheet" href="/dev-login.css">${isThemed ? '\n<link rel="stylesheet" href="/theme.css">' : ''}
<form method="post" action="/auth/dev">
  <h1>Development login</h1>
  <p>This server runs with HB_DEV_LOGIN=1. Anyone who can reach it can sign in as anyone.</p>
  <input type="hidden" name="state" value="${escapeHtml(request.query.get('state') ?? '')}">
  <label>Email <input name="email" type="email" required autofocus></label>
  <label>Name <input name="name" required></label>
  <button>Sign in</button>
</form>
</html>`,
    'text/html; charset=utf-8',
  )

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
