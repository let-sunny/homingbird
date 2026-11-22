import { Task as T } from '@homingbird/kernel'
import { type Contract, CredentialId, type Invite, type ResponseOf } from '@homingbird/protocol'
import { decideConsent, describeConsent } from '../auth/authorization-codes.ts'
import { decideDeviceRequest, describeDeviceRequest } from '../auth/device-authorization.ts'
import { createInvite, listInvites, revokeInvite } from '../auth/invites.ts'
import { createJoinCode, joinCodeStatus } from '../auth/join-codes.ts'
import { listCredentials, renameCredential, revokeCredential } from '../domain/credentials.ts'
import type { Handlers } from './handlers.ts'
import { identifier } from './route-parameters.ts'

/**
 * A person's credentials, the device and consent requests and join codes that issue an agent one, and
 * the invite links that let a new person sign in.
 */
export const credentialHandlers = {
  'credentials.list': (_, caller) =>
    T.map((credentials: Awaited<ResponseOf<Contract['credentials.list']>>['credentials']) => ({
      credentials,
    }))(listCredentials(caller.member.id, caller.credential.id)),
  'credentials.rename': ({ params, body }, caller) =>
    T.flatMap((id: CredentialId) => renameCredential(caller.member.id, caller.credential.id, id, body.name))(
      identifier(CredentialId, params.id),
    ),
  'credentials.revoke': ({ params }, caller) =>
    T.as({})(
      T.flatMap((id: CredentialId) => revokeCredential(caller.member.id, id))(
        identifier(CredentialId, params.id),
      ),
    ),
  'device.get': ({ params }) => describeDeviceRequest(params.userCode),
  'device.decide': ({ params, body }, caller) => T.as({})(decideDeviceRequest(caller, params.userCode, body)),
  'joinCodes.create': ({ body }, caller) => createJoinCode(caller, body.channel),
  'joinCodes.status': ({ params }, caller) => joinCodeStatus(caller, params.id),
  'invites.list': (_, caller) => T.map((invites: Invite[]) => ({ invites }))(listInvites(caller)),
  'invites.create': ({ body }, caller) => createInvite(caller, body.email),
  'invites.revoke': ({ params }, caller) => T.as({})(revokeInvite(caller, params.id)),
  'consent.get': ({ params }) => describeConsent(params.id),
  'consent.decide': ({ params, body }, caller) => decideConsent(caller, params.id, body),
} satisfies Partial<Handlers>
