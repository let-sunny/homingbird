import { Task as T, makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import {
  SLACK_API,
  SLACK_CALL_TIMEOUT_MS,
  type SlackCall,
  escapeSlackText,
  isTokenRefusal,
  makeSlackApi,
} from '../src/slack/slack-web-api.ts'

const TOKEN = 'xoxb-1111-2222-secret'

const slackAnswering = (answer: (init: RequestInit, url: string) => Promise<Response>) => {
  const calls: Array<{ url: string; init: RequestInit; form: URLSearchParams }> = []
  const fetch = (url: string, init?: RequestInit) => {
    calls.push({ url, init: init!, form: new URLSearchParams(init!.body as string) })
    return answer(init!, url)
  }
  return { calls, api: makeSlackApi(fetch, TOKEN) }
}

const json = (body: unknown, init?: ResponseInit) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200, ...init }))

const outcome = <A>(call: SlackCall<A>, clock = makeTestClock()) =>
  T.runPromise(
    T.catchAll((failure: unknown) => T.succeed({ failed: failure }))(T.map((value: A) => ({ value }))(call)),
    { clock },
  )

const USER = {
  id: 'U1',
  team_id: 'T1',
  name: 'ana',
  real_name: 'Ana Silva',
  profile: { display_name: 'Ana', email: 'ana@example.com' },
}

describe('a call to Slack', () => {
  it('posts a form to the method with the token as a bearer, and follows no redirect', async () => {
    const { calls, api } = slackAnswering(() => json({ ok: true, channel: 'C1', ts: '1.000100' }))
    expect(await outcome(api.postMessage({ channel: 'C1', text: 'Thursday.' }))).toEqual({
      value: { channel: 'C1', ts: '1.000100' },
    })
    const [{ url, init, form }] = calls as [(typeof calls)[number]]
    expect(url).toBe(`${SLACK_API}chat.postMessage`)
    expect(url).toBe('https://slack.com/api/chat.postMessage')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    expect(init.headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    })
    expect(Object.fromEntries(form)).toEqual({
      channel: 'C1',
      text: 'Thursday.',
      unfurl_links: 'false',
      unfurl_media: 'false',
    })
  })

  it('replies in the thread it names', async () => {
    const { calls, api } = slackAnswering(() => json({ ok: true, channel: 'C1', ts: '2.0' }))
    await outcome(api.postMessage({ channel: 'C1', text: 'Yes.', threadTs: '1.0' }))
    expect(calls[0]!.form.get('thread_ts')).toBe('1.0')
  })

  it('reports Slack’s own error code when it refuses, without the token', async () => {
    const { api } = slackAnswering(() => json({ ok: false, error: 'channel_not_found' }))
    const result = await outcome(api.postMessage({ channel: 'C404', text: 'Hi' }))
    expect(result).toEqual({
      failed: { _tag: 'SlackRefused', method: 'chat.postMessage', error: 'channel_not_found' },
    })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('names an unknown error when Slack refuses without a code', async () => {
    const { api } = slackAnswering(() => json({ ok: false }))
    expect(await outcome(api.authTest())).toEqual({
      failed: { _tag: 'SlackRefused', method: 'auth.test', error: 'unknown_error' },
    })
  })

  it('passes on how long Slack asks to wait when it limits the rate, within an hour', async () => {
    const waits = async (retryAfter: string | null) =>
      outcome(
        slackAnswering(() =>
          json(
            { ok: false, error: 'ratelimited' },
            { status: 429, headers: retryAfter === null ? {} : { 'retry-after': retryAfter } },
          ),
        ).api.authTest(),
      )
    expect(await waits('30')).toEqual({
      failed: { _tag: 'SlackRateLimited', method: 'auth.test', retryAfterSeconds: 30 },
    })
    expect(await waits('86400')).toMatchObject({ failed: { retryAfterSeconds: 3600 } })
    expect(await waits(null)).toMatchObject({ failed: { retryAfterSeconds: 1 } })
    expect(await waits('soon')).toMatchObject({ failed: { retryAfterSeconds: 1 } })
    expect(await waits('0')).toMatchObject({ failed: { retryAfterSeconds: 1 } })
  })

  it('calls Slack unreachable when the request fails, the status is not OK or the answer is not Slack’s', async () => {
    const unreachable = { failed: { _tag: 'SlackUnreachable', method: 'chat.postMessage' } }
    const post = (answer: () => Promise<Response>) =>
      outcome(slackAnswering(answer).api.postMessage({ channel: 'C1', text: 'Hi' }))
    expect(await post(() => Promise.reject(new TypeError('fetch failed')))).toEqual(unreachable)
    expect(await post(() => json({ ok: true }, { status: 502 }))).toEqual(unreachable)
    expect(await post(() => Promise.resolve(new Response('<html>', { status: 200 })))).toEqual(unreachable)
    expect(await post(() => json({ answer: 'yes' }))).toEqual(unreachable)
    expect(await post(() => json({ ok: true, channel: 'C1' }))).toEqual(unreachable)
  })

  it('gives up after ten seconds, aborting the request', async () => {
    const clock = makeTestClock()
    let aborted = false
    const { api } = slackAnswering(
      (init) =>
        new Promise<Response>(() => {
          init.signal?.addEventListener('abort', () => void (aborted = true))
        }),
    )
    const running = outcome(api.authTest(), clock)
    expect(SLACK_CALL_TIMEOUT_MS).toBe(10_000)
    await clock.advance(SLACK_CALL_TIMEOUT_MS)
    expect(await running).toEqual({ failed: { _tag: 'SlackUnreachable', method: 'auth.test' } })
    expect(aborted).toBe(true)
  })
})

describe('the Slack methods Homingbird uses', () => {
  it('says which workspace and bot the token acts as', async () => {
    const { api } = slackAnswering(() =>
      json({ ok: true, team: 'Acme', team_id: 'T1', user_id: 'UBOT', bot_id: 'BBOT' }),
    )
    expect(await outcome(api.authTest())).toEqual({
      value: { teamId: 'T1', team: 'Acme', userId: 'UBOT', botId: 'BBOT' },
    })
    const bare = slackAnswering(() => json({ ok: true, team_id: 'T1', user_id: 'U2' })).api
    expect(await outcome(bare.authTest())).toEqual({
      value: { teamId: 'T1', team: null, userId: 'U2', botId: null },
    })
  })

  it('posts a message only its user sees, in the thread when there is one', async () => {
    const { calls, api } = slackAnswering(() => json({ ok: true, message_ts: '3.0' }))
    expect(
      await outcome(api.postEphemeral({ channel: 'C1', user: 'U1', text: 'Only you', threadTs: '1.0' })),
    ).toEqual({
      value: undefined,
    })
    expect(calls[0]!.url).toBe(`${SLACK_API}chat.postEphemeral`)
    expect(Object.fromEntries(calls[0]!.form)).toEqual({
      channel: 'C1',
      user: 'U1',
      text: 'Only you',
      thread_ts: '1.0',
    })
  })

  it('opens the direct message with one user', async () => {
    const { calls, api } = slackAnswering(() => json({ ok: true, channel: { id: 'D1' } }))
    expect(await outcome(api.openDirect('U1'))).toEqual({ value: 'D1' })
    expect(calls[0]!.form.get('users')).toBe('U1')
  })

  it('reads a user’s name, email and whether they are a full member of the workspace', async () => {
    const { calls, api } = slackAnswering(() => json({ ok: true, user: USER }))
    expect(await outcome(api.userInfo('U1'))).toEqual({
      value: {
        id: 'U1',
        teamId: 'T1',
        name: 'Ana',
        email: 'ana@example.com',
        isFullMember: true,
        deleted: false,
      },
    })
    expect(calls[0]!.form.get('user')).toBe('U1')
  })

  it('names a user by their display name, then their real name, then their handle, then their id', async () => {
    const named = async (user: Record<string, unknown>) =>
      ((await outcome(slackAnswering(() => json({ ok: true, user })).api.userInfo('U1'))) as any).value.name
    expect(await named({ id: 'U1', real_name: 'Ana Silva', profile: { display_name: ' ' } })).toBe(
      'Ana Silva',
    )
    expect(await named({ id: 'U1', name: 'ana' })).toBe('ana')
    expect(await named({ id: 'U1' })).toBe('U1')
  })

  it('counts a guest, a bot, an app, a deactivated user and someone from another organization out', async () => {
    for (const flag of [
      'is_restricted',
      'is_ultra_restricted',
      'is_bot',
      'is_app_user',
      'deleted',
      'is_stranger',
    ]) {
      const { api } = slackAnswering(() => json({ ok: true, user: { ...USER, [flag]: true } }))
      expect(await outcome(api.userInfo('U1'))).toMatchObject({ value: { isFullMember: false } })
    }
    const gone = slackAnswering(() => json({ ok: true, user: { id: 'U1', deleted: true } })).api
    expect(await outcome(gone.userInfo('U1'))).toMatchObject({
      value: { deleted: true, email: null, teamId: null },
    })
  })

  it('finds a user by email, and reads no such user as none', async () => {
    const found = slackAnswering(() => json({ ok: true, user: USER }))
    expect(await outcome(found.api.userByEmail('ana@example.com'))).toMatchObject({ value: { id: 'U1' } })
    expect(found.calls[0]!.form.get('email')).toBe('ana@example.com')
    const missing = slackAnswering(() => json({ ok: false, error: 'users_not_found' })).api
    expect(await outcome(missing.userByEmail('nobody@example.com'))).toEqual({ value: null })
    const refused = slackAnswering(() => json({ ok: false, error: 'invalid_auth' })).api
    expect(await outcome(refused.userByEmail('ana@example.com'))).toMatchObject({
      failed: { error: 'invalid_auth' },
    })
  })

  it('reads a channel with its member count, privacy, sharing and whether it is archived', async () => {
    const { calls, api } = slackAnswering(() =>
      json({
        ok: true,
        channel: {
          id: 'C1',
          name: 'billing-help',
          is_private: true,
          is_ext_shared: false,
          is_archived: false,
          num_members: 12,
        },
      }),
    )
    expect(await outcome(api.channelInfo('C1'))).toEqual({
      value: {
        id: 'C1',
        name: 'billing-help',
        isPrivate: true,
        isExternal: false,
        isArchived: false,
        memberCount: 12,
      },
    })
    expect(Object.fromEntries(calls[0]!.form)).toEqual({ channel: 'C1', include_num_members: 'true' })
    const bare = slackAnswering(() => json({ ok: true, channel: { id: 'C2' } })).api
    expect(await outcome(bare.channelInfo('C2'))).toEqual({
      value: {
        id: 'C2',
        name: 'C2',
        isPrivate: false,
        isExternal: false,
        isArchived: false,
        memberCount: null,
      },
    })
  })

  it('reads a thread’s first page, its parent first', async () => {
    const { calls, api } = slackAnswering(() =>
      json({
        ok: true,
        messages: [
          { ts: '1.0', user: 'U1', text: 'Question' },
          { ts: '2.0', bot_id: 'B1' },
        ],
      }),
    )
    expect(await outcome(api.threadReplies('C1', '1.0'))).toEqual({
      value: [
        { ts: '1.0', user: 'U1', botId: null, text: 'Question' },
        { ts: '2.0', user: null, botId: 'B1', text: '' },
      ],
    })
    expect(Object.fromEntries(calls[0]!.form)).toEqual({ channel: 'C1', ts: '1.0', limit: '200' })
  })

  it('adds a reaction, and takes one already there as added', async () => {
    const { calls, api } = slackAnswering(() => json({ ok: true }))
    expect(await outcome(api.addReaction('C1', '1.0', 'eyes'))).toEqual({ value: undefined })
    expect(Object.fromEntries(calls[0]!.form)).toEqual({ channel: 'C1', timestamp: '1.0', name: 'eyes' })
    const again = slackAnswering(() => json({ ok: false, error: 'already_reacted' })).api
    expect(await outcome(again.addReaction('C1', '1.0', 'eyes'))).toEqual({ value: undefined })
    const refused = slackAnswering(() => json({ ok: false, error: 'not_in_channel' })).api
    expect(await outcome(refused.addReaction('C1', '1.0', 'eyes'))).toMatchObject({
      failed: { error: 'not_in_channel' },
    })
  })
})

describe('what Slack’s answers mean', () => {
  it('takes a refusal that names the token as the token no longer working, and nothing else', () => {
    for (const error of [
      'invalid_auth',
      'not_authed',
      'account_inactive',
      'token_revoked',
      'token_expired',
      'no_permission',
    ])
      expect(isTokenRefusal({ _tag: 'SlackRefused', method: 'auth.test', error } as never)).toBe(true)
    expect(
      isTokenRefusal({ _tag: 'SlackRefused', method: 'auth.test', error: 'channel_not_found' } as never),
    ).toBe(false)
    expect(isTokenRefusal({ _tag: 'SlackUnreachable', method: 'auth.test' } as never)).toBe(false)
  })

  it('escapes the three characters that make Slack’s special forms, and nothing else', () => {
    expect(escapeSlackText('<!channel> & <@U1> <https://evil.example|bank>')).toBe(
      '&lt;!channel&gt; &amp; &lt;@U1&gt; &lt;https://evil.example|bank&gt;',
    )
    expect(escapeSlackText('Plain *bold* `code`')).toBe('Plain *bold* `code`')
  })
})
