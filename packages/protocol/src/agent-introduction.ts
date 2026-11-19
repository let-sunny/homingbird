import type { Member } from './model.ts'
import { wrapNote } from './wrap.ts'

/**
 * A colleague's agent introduction as a model reads it: the public sentences their person wrote, quoted
 * through wrapNote like a note, because a colleague wrote them. Null when there are none to show.
 */
export const quotedIntroduction = (
  member: Pick<Member, 'id' | 'name' | 'email'>,
  sentences: ReadonlyArray<string> | undefined,
  nonce: () => string,
): string | null =>
  sentences === undefined || sentences.length === 0
    ? null
    : wrapNote({
        noteId: `${member.id}/agent-introduction`,
        authorName: member.name,
        authorEmail: member.email,
        sentAt: null,
        body: sentences.join('\n'),
        nonce: nonce(),
      })
