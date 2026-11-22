import { Task as T } from '@homingbird/kernel'
import { ConversationId, type DraftPreview } from '@homingbird/protocol'
import { allowDraftPreviews, draftPreviewAllowanceOf, previewsFor } from '../domain/draft-previews.ts'
import type { Handlers } from './handlers.ts'
import { identifier } from './route-parameters.ts'

/** Whom a person lets see their agent's unconfirmed drafts, and the previews others let them see. */
export const previewHandlers = {
  'me.draftPreviews.get': (_, caller) => draftPreviewAllowanceOf(caller.member.id),
  'me.draftPreviews.set': ({ body }, caller) => allowDraftPreviews(caller, body),
  'previews.list': ({ params }, caller) =>
    T.map((previews: DraftPreview[]) => ({ previews }))(
      T.flatMap((id: ConversationId) => previewsFor(caller.member.id, id))(
        identifier(ConversationId, params.id),
      ),
    ),
} satisfies Partial<Handlers>
