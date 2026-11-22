import type { Session, TestServer } from './harness.ts'

export const OFFICE_HOURS = {
  kind: 'answer',
  topic: 'Office hours',
  rule: 'The office is open from 9 to 5, Monday to Friday.',
  place: null,
} as const

/** A basis that says the draft applied the saved answer above. */
export const APPLIED = 'Principles applied: Office hours'

/** Switches automatic sending on or off for the organization, as its administrator. */
export const allowAutoSend = async (admin: Session, on: boolean): Promise<void> => {
  const settings = (await admin.api('GET', '/admin/settings')).json
  await admin.api('PUT', '/admin/settings', { ...settings, features: { ...settings.features, autoSend: on } })
}

/** The direct conversation between two people, made by one sent note. */
export const directRoom = async (from: Session, to: Session): Promise<string> => {
  const draft = (await from.api('POST', '/drafts', { to: [to.me.member.id], body: 'Hello' })).json
  return (
    await from.api('POST', `/drafts/${draft.id}/send`, {
      expected: { body: draft.body, conversationId: draft.conversationId },
    })
  ).json.conversationId
}

/** The saved answer above, switched on for the given places. */
export const savedAnswerFor = async (
  person: Session,
  places: ReadonlyArray<string>,
  answer: Readonly<Record<string, unknown>> = OFFICE_HOURS,
) => {
  const saved = (await person.api('POST', '/principles', answer)).json
  return (await person.api('PUT', `/principles/${saved.id}/auto-send`, { enabled: true, places })).json
}

export const eventsOf = async (session: Session): Promise<ReadonlyArray<{ body: { type: string } }>> =>
  (await session.api('GET', '/events/poll?after=0')).json.events

export type { Session, TestServer }
