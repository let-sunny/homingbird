/** The web client's pages by route name, the only values `page_viewed` carries. */
export const ANALYTICS_PAGES = [
  'home',
  'conversation',
  'people',
  'group',
  'channels',
  'channel',
  'channel-agent',
  'debates',
  'debate',
  'search',
  'activity',
  'profile',
  'agent',
  'measured',
  'character',
  'device',
  'consent',
  'admin',
  'signed-out',
  'invite',
  'invite-refused',
  'unknown',
] as const

export type AnalyticsPage = (typeof ANALYTICS_PAGES)[number]

/** The command line's agent presets by name, and `custom` for any other command. */
export const ANALYTICS_AGENT_PRESETS = ['claude', 'codex', 'antigravity', 'gemini', 'custom'] as const

export type AnalyticsAgentPreset = (typeof ANALYTICS_AGENT_PRESETS)[number]
