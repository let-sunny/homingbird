import { Task as T } from '@homingbird/kernel'
import { type Contract, CredentialId, type ResponseOf } from '@homingbird/protocol'
import { decideConsent, describeConsent } from '../auth/authorization-codes.ts'
import { decideDeviceRequest, describeDeviceRequest } from '../auth/device-authorization.ts'
import { listCredentials, renameCredential, revokeCredential } from '../domain/credentials.ts'
import type { Handlers } from './handlers.ts'
import { identifier } from './route-parameters.ts'

/** A person's credentials, and the device and consent requests that issue an agent one. */
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
  'consent.get': ({ params }) => describeConsent(params.id),
  'consent.decide': ({ params, body }, caller) => decideConsent(caller, params.id, body),
} satisfies Partial<Handlers>
