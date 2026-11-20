/** Everything measured about people, as "What is measured" lists it; a test fails for a response field left out. */
export const MEASURES = [
  {
    key: 'decisions',
    audience: 'you',
    fields: ['written', 'sentAsWritten', 'sentAfterEdits', 'discarded', 'decided', 'verdict', 'weeks'],
  },
  {
    key: 'decisionTime',
    audience: 'you',
    fields: ['medianDecisionMs', 'quickApprovals', 'quickApprovalsFrequent'],
  },
  { key: 'skips', audience: 'you', fields: ['skipped', 'skipReasons', 'expiredRequests'] },
  { key: 'ownNotes', audience: 'you', fields: ['wroteYourself', 'debateResultsSent'] },
  { key: 'places', audience: 'you', fields: ['places'] },
  { key: 'labels', audience: 'you', fields: ['byClient', 'byModel'] },
  {
    key: 'sessions',
    audience: 'you',
    fields: ['sessions', 'byAge', 'byContext', 'latest', 'edited', 'ageMinutes', 'contextPercent'],
  },
  { key: 'week', audience: 'you', fields: ['week', 'notesSent', 'repliesReceived', 'medianReplyMs'] },
  {
    key: 'activity',
    audience: 'administrators',
    fields: ['activeMembers', 'notesSent', 'newNotes', 'answered', 'medianFirstReplyMs'],
  },
  {
    key: 'decisions',
    audience: 'administrators',
    fields: ['agentDraftsWritten', 'written', 'sentAsWritten', 'sentAfterEdits', 'discarded'],
  },
  {
    key: 'decisionTime',
    audience: 'administrators',
    fields: ['medianDecisionMs', 'quickApprovals', 'weeks', 'quickWarning'],
  },
  { key: 'authorship', audience: 'administrators', fields: ['authorship', 'agent', 'humanEdited', 'human'] },
  { key: 'skips', audience: 'administrators', fields: ['skipped'] },
  { key: 'debateResults', audience: 'administrators', fields: ['debateResultsSent'] },
  { key: 'places', audience: 'administrators', fields: ['places', 'hiddenPlaces'] },
  { key: 'labels', audience: 'administrators', fields: ['byClient', 'byModel', 'hiddenLabels'] },
  {
    key: 'delivery',
    audience: 'administrators',
    fields: ['delivery', 'received', 'toAgents', 'pickedUpQuickly', 'medianPickupMs', 'waitedWithoutAgent'],
  },
  { key: 'blocks', audience: 'administrators', fields: ['blocks'] },
] as const satisfies ReadonlyArray<Measure>

export type MeasureAudience = 'you' | 'administrators'

export interface Measure {
  readonly key: string
  readonly audience: MeasureAudience
  readonly fields: ReadonlyArray<string>
}

/** Response fields that hold no figure about anyone: when it was made, the settings, and labels. */
export const NOT_MEASURES: ReadonlyArray<string> = [
  'generatedAt',
  'quickApprovalSeconds',
  'minimumDecided',
  'minimumGroupSize',
  'periods',
  'days',
  'current',
  'previous',
  'start',
  'place',
  'label',
  'reason',
  'count',
  'bucket',
  'agentName',
  'at',
]
