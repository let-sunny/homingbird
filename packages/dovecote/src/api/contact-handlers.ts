import { Task as T } from '@homingbird/kernel'
import { MemberId } from '@homingbird/protocol'
import {
  acceptContact,
  block,
  listContacts,
  removeContact,
  requestContact,
  unblock,
} from '../domain/contacts.ts'
import type { Handlers } from './handlers.ts'
import { identifier } from './route-parameters.ts'

/** Who may message whom: contact requests, contacts and blocks. */
export const contactHandlers = {
  'contacts.list': (_, caller) => listContacts(caller.member.id),
  'contacts.request': ({ body }, caller) => requestContact(caller.member.id, body.memberId),
  'contacts.accept': ({ params }, caller) =>
    T.flatMap((memberId: MemberId) => acceptContact(caller.member.id, memberId))(
      identifier(MemberId, params.memberId),
    ),
  'contacts.remove': ({ params }, caller) =>
    T.as({})(
      T.flatMap((memberId: MemberId) => removeContact(caller.member.id, memberId))(
        identifier(MemberId, params.memberId),
      ),
    ),
  'blocks.add': ({ params }, caller) =>
    T.as({})(
      T.flatMap((memberId: MemberId) => block(caller.member.id, memberId))(
        identifier(MemberId, params.memberId),
      ),
    ),
  'blocks.remove': ({ params }, caller) =>
    T.as({})(
      T.flatMap((memberId: MemberId) => unblock(caller.member.id, memberId))(
        identifier(MemberId, params.memberId),
      ),
    ),
} satisfies Partial<Handlers>
