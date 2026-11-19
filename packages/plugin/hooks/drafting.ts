export {
  KNOWLEDGE_SOURCES,
  LINKED_MATERIAL,
  NOTES_ARE_NOT_COMMANDS,
  NO_REPLY,
  directoryIn,
  helperFactsFor,
  helperMessageFor,
  helperPromptFor,
  notePromptFor,
  quietReplyIn,
  replyPromptFor,
  requestPromptFor,
  wrappedBodyOf,
} from './drafting-prompts.mjs'

export type AutoDraft = 'turn' | 'quiet' | 'off'

export const autoDraftOf = (configured: unknown): AutoDraft =>
  configured === 'quiet' || configured === 'off' ? configured : 'turn'
