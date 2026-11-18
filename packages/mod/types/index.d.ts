export type HomingbirdConversation = {
  id: string
  with: string
  kind?: 'dm' | 'group' | 'topic'
  title?: string | null
  unreadCount: number
  draftCount: number
}

export type HomingbirdAwaiting = {
  noteId: string
  from: { name: string; email: string }
  wrapped: string
}

export type HomingbirdDraft = {
  id: string
  conversationId: string
  inReplyTo: string | null
  agentName: string | null
  body: string
}

export type HomingbirdDraftRequest = {
  id: string
  conversationId: string
  inReplyTo: string | null
  instruction: string
  answers: string | null
}

export type HomingbirdOverview = {
  server: string
  memberName: string
  locale?: string | null
  approveButtonAllowed?: boolean
  hasApproveButton: boolean
  conversations: HomingbirdConversation[]
  awaiting: HomingbirdAwaiting[]
  drafts: HomingbirdDraft[]
}

export type HomingbirdConnection =
  | 'idle'
  | 'starting'
  | 'live'
  | 'reconnecting'
  | 'signed-out'
  | 'unavailable'

export type HomingbirdDesk = 'not-desk' | 'desk' | 'moved'

export type HomingbirdSignIn = { verificationUri: string; userCode: string }

declare module 'claude-code' {
  interface PluginState {
    homingbird: {
      overview: Shaped<HomingbirdOverview | null>
      requests: Shaped<HomingbirdDraftRequest[]>
      connection: HomingbirdConnection
      desk: HomingbirdDesk
      signIn: HomingbirdSignIn | null
      editing: string | null
      problem: string | null
    }
  }
}
