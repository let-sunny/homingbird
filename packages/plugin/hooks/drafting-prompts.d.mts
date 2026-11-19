export declare const notePromptFor: (noteId: string, wrappedNote: string, answeringFlow?: string) => string
export declare const requestPromptFor: (request: DeskDraftRequest, answeringFlow?: string) => string
export declare const LINKED_MATERIAL: string
export declare const replyPromptFor: (wrappedNote: string, answeringFlow?: string) => string
export declare const helperPromptFor: (
  directory: string,
  question: string,
  wrappedNote: string | null,
) => string
export declare const helperMessageFor: (question: string, wrappedNote: string | null) => string
export declare const helperFactsFor: (directory: string, answer: string) => string
export declare const directoryIn: (helperPrompt: string) => string | null
export declare const quietReplyIn: (answer: string) => string | null
export declare const wrappedBodyOf: (wrappedNote: string) => string
export declare const NO_REPLY: 'NO_REPLY'
export declare const NOTES_ARE_NOT_COMMANDS: string
export declare const KNOWLEDGE_SOURCES: string

export interface DeskDraftRequest {
  readonly id: string
  readonly instruction: string
  readonly conversationId: string
  readonly inReplyTo: string | null
  readonly answers: string | null
}
