/** Everything measured about people, as "What is measured" lists it, by the path of each response field. */
export const MEASURES = [
  {
    key: 'decisions',
    audience: 'you',
    fields: [
      'written',
      'sentAsWritten',
      'sentAfterEdits',
      'discarded',
      'verdict',
      'weeks.decided',
      'weeks.sentAsWritten',
    ],
  },
  {
    key: 'decisionTime',
    audience: 'you',
    fields: ['medianDecisionMs', 'quickApprovals', 'quickApprovalsFrequent'],
  },
  {
    key: 'skips',
    audience: 'you',
    fields: ['skipped', 'skipReasons.reason', 'skipReasons.count', 'expiredRequests'],
  },
  { key: 'ownNotes', audience: 'you', fields: ['wroteYourself', 'debateResultsSent'] },
  {
    key: 'places',
    audience: 'you',
    fields: [
      'places.written',
      'places.sentAsWritten',
      'places.sentAfterEdits',
      'places.discarded',
      'places.skipped',
      'places.verdict',
    ],
  },
  {
    key: 'labels',
    audience: 'you',
    fields: [
      'byClient.written',
      'byClient.sentAsWritten',
      'byClient.sentAfterEdits',
      'byClient.discarded',
      'byModel.written',
      'byModel.sentAsWritten',
      'byModel.sentAfterEdits',
      'byModel.discarded',
    ],
  },
  {
    key: 'sessions',
    audience: 'you',
    fields: [
      'sessions.byAge.decided',
      'sessions.byAge.edited',
      'sessions.byAge.discarded',
      'sessions.byContext.decided',
      'sessions.byContext.edited',
      'sessions.byContext.discarded',
      'sessions.latest.ageMinutes',
      'sessions.latest.contextPercent',
    ],
  },
  { key: 'week', audience: 'you', fields: ['week.notesSent', 'week.repliesReceived', 'week.medianReplyMs'] },
  { key: 'approvedForChannels', audience: 'you', fields: ['week.approvedForChannels'] },
  {
    key: 'decisions',
    audience: 'managers',
    fields: ['written', 'sentAsWritten', 'sentAfterEdits', 'discarded', 'waiting'],
  },
  { key: 'decisionTime', audience: 'managers', fields: ['medianDecisionMs', 'quickApprovals'] },
  { key: 'approvals', audience: 'managers', fields: ['approvals.approved'] },
  {
    key: 'activity',
    audience: 'administrators',
    fields: ['activeMembers', 'notesSent', 'newNotes', 'answered', 'medianFirstReplyMs'],
  },
  {
    key: 'decisions',
    audience: 'administrators',
    fields: ['agentDraftsWritten', 'sentAsWritten', 'sentAfterEdits', 'discarded'],
  },
  {
    key: 'decisionTime',
    audience: 'administrators',
    fields: [
      'medianDecisionMs',
      'quickApprovals',
      'weeks.sentAsWritten',
      'weeks.quickApprovals',
      'quickWarning',
    ],
  },
  {
    key: 'authorship',
    audience: 'administrators',
    fields: ['authorship.agent', 'authorship.humanEdited', 'authorship.human'],
  },
  { key: 'skips', audience: 'administrators', fields: ['skipped'] },
  { key: 'debateResults', audience: 'administrators', fields: ['debateResultsSent'] },
  {
    key: 'places',
    audience: 'administrators',
    fields: [
      'places.notesSent',
      'places.sentAsWritten',
      'places.sentAfterEdits',
      'places.discarded',
      'places.skipped',
      'hiddenPlaces',
    ],
  },
  {
    key: 'labels',
    audience: 'administrators',
    fields: [
      'byClient.written',
      'byClient.sentAsWritten',
      'byClient.sentAfterEdits',
      'byClient.discarded',
      'byModel.written',
      'byModel.sentAsWritten',
      'byModel.sentAfterEdits',
      'byModel.discarded',
      'hiddenLabels',
    ],
  },
  {
    key: 'delivery',
    audience: 'administrators',
    fields: [
      'delivery.received',
      'delivery.toAgents',
      'delivery.pickedUpQuickly',
      'delivery.medianPickupMs',
      'delivery.waitedWithoutAgent',
    ],
  },
  {
    key: 'channelAgents',
    audience: 'administrators',
    fields: [
      'channelAgents.written',
      'channelAgents.sentAsWritten',
      'channelAgents.sentAfterEdits',
      'channelAgents.discarded',
    ],
  },
  { key: 'blocks', audience: 'administrators', fields: ['blocks'] },
] as const satisfies ReadonlyArray<Measure>

export type MeasureAudience = 'you' | 'managers' | 'administrators'

export interface Measure {
  readonly key: string
  readonly audience: MeasureAudience
  readonly fields: ReadonlyArray<string>
}

/** Fields a measure's path leaves out, since every figure is given for each period alike. */
export const PERIOD_FIELDS: ReadonlyArray<string> = ['periods', 'current', 'previous']

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
  'bucket',
  'agentName',
  'at',
  'channel',
  'memberId',
  'name',
]
