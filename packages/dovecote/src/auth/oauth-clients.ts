import { Task as T } from '@homingbird/kernel'
import { recordAudit } from '../domain/audit.ts'
import type { AppEnv } from '../environment.ts'
import { type RequestEnv, transact } from '../events/events.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { isClientMetadataUrl } from './client-metadata.ts'
import { OAuthError } from './oauth.ts'
import { isAllowedRedirectUri } from './redirect-policy.ts'

export interface RegisteredClient {
  readonly client_id: string
  readonly client_name: string
  readonly redirect_uris: ReadonlyArray<string>
}

export const registerClient = (
  name: string,
  redirectUris: ReadonlyArray<string>,
): T.Task<RegisteredClient, OAuthError, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const { redirectHosts } = env.config.oauth
    if (
      redirectUris.length === 0 ||
      redirectUris.length > MAX_REDIRECT_URIS ||
      !redirectUris.every((uri) => isAllowedRedirectUri(uri, redirectHosts))
    )
      return yield* T.fail(
        OAuthError({
          code: 'invalid_redirect_uri',
          description:
            'redirect_uris must be loopback http, an app scheme, or https on a host this server allows',
        }),
      )
    const client: RegisteredClient = {
      client_id: `client_${env.random.identifier()}`,
      client_name: name.slice(0, 200) || 'Unnamed client',
      redirect_uris: redirectUris,
    }
    yield* run(
      insertInto('oauth_clients', {
        id: client.client_id,
        name: client.client_name,
        redirect_uris: JSON.stringify(client.redirect_uris),
        created_at: env.clock.now(),
      }),
    )
    yield* recordAudit('oauth.client_registered', {
      targetId: client.client_id,
      clientId: client.client_id,
      detail: { redirectHosts: redirectHostsOf(client.redirect_uris) },
    })
    return client
  })

export interface KnownClient extends RegisteredClient {
  readonly configured: boolean
}

/** A client by its id: configured by the operator, described by a metadata document, or registered. */
export const requireClient = (id: string): T.Task<KnownClient, OAuthError, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const configured = env.config.oauth.clients.find((client) => client.client_id === id)
    if (configured !== undefined) return { ...configured, configured: true }
    if (isClientMetadataUrl(id)) return { ...(yield* clientFromMetadataDocument(id)), configured: false }
    const row = yield* first<{ id: string; name: string; redirect_uris: string }>(
      sql`SELECT * FROM oauth_clients WHERE id = ${id}`,
    )
    if (row === null)
      return yield* T.fail(OAuthError({ code: 'invalid_client', description: 'Unknown client_id.' }))
    return {
      client_id: row.id,
      client_name: row.name,
      redirect_uris: JSON.parse(row.redirect_uris) as string[],
      configured: false,
    }
  })

export const hostOf = (uri: string): string => {
  const url = new URL(uri)
  return url.host || url.protocol
}

const MAX_REDIRECT_URIS = 10

const clientFromMetadataDocument = (clientId: string): T.Task<RegisteredClient, OAuthError, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const resolved = yield* T.result(env.clientMetadata.resolve(clientId))
    if (resolved._tag === 'Err') {
      env.log.emit(
        { name: 'oauth.client_metadata_refused', attributes: { reason: resolved.error.reason } },
        env.requestId,
      )
      return yield* T.fail(
        OAuthError({
          code: 'invalid_client',
          description: `The client metadata document was refused: ${resolved.error.reason}.`,
        }),
      )
    }
    const { client, fetched } = resolved.value
    if (fetched)
      yield* transact(
        recordAudit('oauth.client_resolved', {
          targetId: client.client_id,
          clientId: client.client_id,
          detail: { redirectHosts: redirectHostsOf(client.redirect_uris) },
        }),
      )
    return client
  })

const redirectHostsOf = (uris: ReadonlyArray<string>): string[] => [...new Set(uris.map(hostOf))].slice(0, 10)
