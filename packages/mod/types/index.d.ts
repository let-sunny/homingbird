export type HomingbirdConversation = {
  id: string
  with: string
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

export type HomingbirdOverview = {
  server: string
  memberName: string
  hasApproveButton: boolean
  conversations: HomingbirdConversation[]
  awaiting: HomingbirdAwaiting[]
  drafts: HomingbirdDraft[]
}

export type HomingbirdConnection = 'starting' | 'live' | 'polling' | 'signed-out' | 'unavailable'

export type HomingbirdSignIn = { verificationUri: string; userCode: string }

declare module 'claude-code' {
  interface PluginState {
    homingbird: {
      overview: HomingbirdOverview | null
      connection: HomingbirdConnection
      signIn: HomingbirdSignIn | null
      editing: string | null
      problem: string | null
    }
  }
}
