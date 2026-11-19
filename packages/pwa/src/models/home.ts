import type { AsRead, ConversationId } from '@homingbird/protocol'
import { mayRestoreConversation, mostRecentConversation } from '../home.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'

/** Home: loading, where to start when there is nothing yet, or a hint to pick a conversation. */
export const homeModel = (input: HomeInput): HomeModel => {
  if (!input.loaded) return { kind: 'loading' }
  if (input.conversations.length === 0) return { kind: 'start', start: startingPointsModel() }
  return { kind: 'pick', text: strings.pickConversation }
}

export const startingPointsModel = (): StartingPoints => ({
  title: strings.start.title,
  points: [
    {
      href: hrefFor({ name: 'channels' }),
      label: strings.start.askChannel,
      hint: strings.start.askChannelHint,
    },
    {
      href: hrefFor({ name: 'people' }),
      label: strings.start.findPerson,
      hint: strings.start.findPersonHint,
    },
    {
      href: hrefFor({ name: 'agent', section: 'connection' }),
      label: strings.start.connect,
      hint: strings.start.connectHint,
    },
  ],
  tour: strings.start.tour,
})

/** The most recent conversation, which home opens by itself beside the list while it still shows home. */
export const conversationToRestore = (input: RestoreInput): ConversationId | null => {
  if (!input.loaded || !input.besideTheList || !mayRestoreConversation(input.hash)) return null
  return mostRecentConversation(input.conversations)?.id ?? null
}

export interface HomeInput {
  readonly loaded: boolean
  readonly conversations: ReadonlyArray<AsRead.Conversation>
}

export interface RestoreInput extends HomeInput {
  readonly besideTheList: boolean
  readonly hash: string
}

export type HomeModel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'start'; readonly start: StartingPoints }
  | { readonly kind: 'pick'; readonly text: string }

export interface StartingPoints {
  readonly title: string
  readonly points: ReadonlyArray<{ readonly href: string; readonly label: string; readonly hint: string }>
  readonly tour: string
}
