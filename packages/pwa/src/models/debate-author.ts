import type { AsRead, MemberId } from '@homingbird/protocol'
import { featureOn } from '../features.ts'
import { strings } from '../strings.ts'
import { memberAvatarOf } from './avatar.ts'
import type { AuthorModel } from './note-item.ts'

/**
 * Who wrote a turn or a draft in a flock, as a note's author shows it: the agent's character, and
 * on selection the model it stated and its connection, unless the organization turned note details off.
 */
export const debateAuthorModel = (input: DebateAuthorInput, written: WrittenInRoom): AuthorModel => {
  const line =
    written.memberId === input.viewerId
      ? strings.authorship.agentYou
      : strings.authorship.agent({ name: input.members.get(written.memberId)?.name ?? strings.formerMember })
  return {
    id: `author-${written.id}`,
    memberId: written.memberId,
    buttonClass: 'author-button is-agent',
    buttonLabel: strings.debates.authorWho({ authorship: line }),
    avatar: memberAvatarOf(input.members.get(written.memberId), featureOn('characters', input.serverInfo), {
      labelled: false,
    }),
    agentMark: true,
    line,
    debate: null,
    details: featureOn('noteDetails', input.serverInfo)
      ? [
          {
            text:
              written.agentModel == null
                ? strings.authorship.modelNotStated
                : strings.authorship.model({ model: written.agentModel }),
            className: null,
          },
          ...(written.agentName === null
            ? []
            : [{ text: strings.authorship.connection({ name: written.agentName }), className: null }]),
          { text: strings.debates.modelReported, className: 'author-reported' },
        ]
      : [],
    sent: null,
  }
}

export interface DebateAuthorInput {
  readonly viewerId: MemberId
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly serverInfo: AsRead.ServerInfo | null
}

/** A turn or a draft: a page-wide id for its details, whose agent wrote it, and what that agent stated. */
export interface WrittenInRoom {
  readonly id: string
  readonly memberId: MemberId
  readonly agentName: string | null
  readonly agentModel?: string | null | undefined
}
