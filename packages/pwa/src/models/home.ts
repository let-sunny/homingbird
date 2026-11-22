import type { AsRead, ConversationId } from '@homingbird/protocol'
import { mayRestoreConversation, mostRecentConversation } from '../home.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { claudeCodeCommands } from './connection.ts'

/** Home: loading, the first steps when there is nothing yet, or a hint to pick a conversation. */
export const homeModel = (input: HomeInput): HomeModel => {
  if (!input.loaded) return { kind: 'loading' }
  if (input.conversations.length === 0) return { kind: 'start', start: startingPointsModel(input) }
  return { kind: 'pick', text: strings.pickConversation }
}

/**
 * The way to a first note, in order: connect the agent (with the two lines to paste, until one is
 * connected), write to someone, then approve the agent's first draft, which says what will happen.
 */
export const startingPointsModel = (input: StartInput): StartingPoints => {
  const words = strings.start
  return {
    title: words.firstTitle,
    steps: [
      input.agentConnected ? connectedStep() : connectStep(input.origin),
      {
        title: words.writeStep,
        hint: words.writeStepHint,
        command: null,
        done: null,
        links: [
          { href: hrefFor({ name: 'people' }), label: words.findPerson, primary: input.agentConnected },
          { href: hrefFor({ name: 'channels' }), label: words.askChannel, primary: false },
        ],
      },
      { title: words.approveStep, hint: words.approveStepHint, command: null, done: null, links: [] },
    ],
    tour: words.tour,
  }
}

/** The most recent conversation, which home opens by itself beside the list while it still shows home. */
export const conversationToRestore = (input: RestoreInput): ConversationId | null => {
  if (!input.loaded || !input.besideTheList || !mayRestoreConversation(input.hash)) return null
  return mostRecentConversation(input.conversations)?.id ?? null
}

export interface StartInput {
  /** Whether the person has an agent credential that is not revoked. */
  readonly agentConnected: boolean
  readonly origin: string
}

export interface HomeInput extends StartInput {
  readonly loaded: boolean
  readonly conversations: ReadonlyArray<AsRead.Conversation>
}

export interface RestoreInput {
  readonly loaded: boolean
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly besideTheList: boolean
  readonly hash: string
}

export type HomeModel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'start'; readonly start: StartingPoints }
  | { readonly kind: 'pick'; readonly text: string }

export interface StartingPoints {
  readonly title: string
  readonly steps: ReadonlyArray<StartStep>
  readonly tour: string
}

export interface StartStep {
  readonly title: string
  readonly hint: string
  /** Lines to paste, shown as code. */
  readonly command: string | null
  /** The word that marks a step already taken. */
  readonly done: string | null
  readonly links: ReadonlyArray<{ readonly href: string; readonly label: string; readonly primary: boolean }>
}

const connectStep = (origin: string): StartStep => ({
  title: strings.start.connectStep,
  hint: strings.start.connectStepHint,
  command: claudeCodeCommands(origin),
  done: null,
  links: [
    {
      href: hrefFor({ name: 'agent', section: 'connection' }),
      label: strings.start.otherAgents,
      primary: false,
    },
  ],
})

const connectedStep = (): StartStep => ({
  title: strings.start.connectedStep,
  hint: strings.start.connectedStepHint,
  command: null,
  done: strings.start.done,
  links: [],
})
