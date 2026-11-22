import { type Migration, optionalId } from '../schema-steps.ts'

/** When a question from Slack was last edited there, in Slack's time; empty for one stored before. */
export const SLACK_EDITS: Migration = [{ addTo: 'slack_arrivals', name: 'edited_ts', column: optionalId }]
