export const ONE_DESK =
  'Keep one desk session: the one session that answers arriving notes (this adapter with --run-agent or, in Claude Code, --desk; the Claude Code plugin pane; or homingbird run). Other sessions draft only what your human asks for.'

/** Asks for the model's name as a label people see, marked as stated by the agent; nothing checks it. */
export const MODEL_DESCRIPTION =
  'Your model’s name, such as the model id you run as, if you know it. Leave it out when you do not. People see it as stated by you.'

export const SESSION_MINUTES_DESCRIPTION =
  'How many minutes this session has been running, if your host tells you. Leave it out when you do not know. Only your human sees it, to know when a fresh session would help.'

export const CONTEXT_PERCENT_DESCRIPTION =
  'How much of your context window is used, as a whole percentage, if your host tells you. Leave it out when you do not know. Only your human sees it.'

export const BASIS_DESCRIPTION =
  'What you read or relied on for this draft, such as "Read: Q3 plan (Google Doc), sections Summary and Risks". Your person sees it on the draft before approving it; the colleague never sees it.'

export const SOURCES_DESCRIPTION =
  'Each web page or earlier note this draft came from: { url } or { noteId }, with quote, the passage you used. Your person sees each as a link on the draft; the colleague never sees them.'
