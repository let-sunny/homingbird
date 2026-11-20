import type { PushTitles } from '../titles.ts'

export const en: PushTitles = {
  noteFrom: (author) => `Note from ${author}`,
  noteFromColleague: 'Note from a colleague',
  draftWaiting: 'A draft is waiting for your approval',
  reviewWaiting: (channel) => `${channel} · An answer waits for your review`,
  test: 'Homingbird test notification',
  testBody: 'Notifications reach this device.',
  deskStopped: 'Your cloud desk is no longer woken',
  deskStoppedBody: 'Homingbird stopped waking it. Open My agent → Connection to see why and set it up again.',
}
