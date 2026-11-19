import { Task as T } from '@homingbird/kernel'
import { credentialFor, readCredential, storedServers } from '../credentials.ts'
import { deskPausePath, deskStateText, isDeskPaused } from '../desk-pause.ts'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { apiFor, calling, requireReadable } from '../session.ts'

/**
 * Who this device is signed in as: on the server named, on the only one, on each of several, or with
 * the credentials file given.
 */
export const status: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
  const file = env.credentialsFile
  const servers = file === null ? yield* storedServers : []
  if (env.server === null && servers.length > 1) return yield* everyServer(servers)
  const agent = yield* readCredential
  if (agent === null)
    return outcome(
      { signedIn: false, ...(env.server !== null && { server: env.server }), servers },
      env.server === null ? 'Not signed in.' : `Not signed in to ${env.server}.`,
    )
  const api = apiFor(env, agent)
  yield* requireReadable(api)
  const me = yield* calling(api['me.get']({}))
  const deskPaused = yield* isDeskPaused(deskPausePath(env, agent.serverUrl, me.member.id))
  return outcome(
    {
      signedIn: true,
      server: agent.serverUrl,
      member: me.member,
      credential: me.credential,
      locale: me.locale ?? null,
      transport: TRANSPORT,
      deskPaused,
      servers,
      ...(file !== null && { credentialsFile: file }),
    },
    [
      `Server:         ${agent.serverUrl}`,
      ...(file === null ? [] : [`Read from:      ${file}`]),
      `Signed in as:   ${me.member.name} <${me.member.email}>`,
      `Credential:     ${me.credential.name} (${me.credential.kind})`,
      `Language:       ${me.locale ?? 'follows the browser'}`,
      `Transport:      ${TRANSPORT}`,
      `Desk:           ${deskStateText(deskPaused)}`,
    ].join('\n'),
  )
})

const everyServer = (servers: ReadonlyArray<string>): T.Task<Outcome, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const rows: Array<{ server: string; member: { name: string; email: string } | null }> = []
    for (const server of servers) {
      const stored = yield* credentialFor(server)
      if (stored === null) continue
      const me = yield* T.result(calling(apiFor(env, stored)['me.get']({})))
      rows.push({
        server,
        member: me._tag === 'Ok' ? { name: me.value.member.name, email: me.value.member.email } : null,
      })
    }
    return outcome(
      { signedIn: true, servers: rows },
      [
        'Signed in to several servers; pass --server <url> to choose one:',
        ...rows.map(
          (row) =>
            `  ${row.server}  ${row.member === null ? '(no longer accepted)' : `${row.member.name} <${row.member.email}>`}`,
        ),
      ].join('\n'),
    )
  })

const TRANSPORT = 'server-sent events, falling back to long-poll'
