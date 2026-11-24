import type { PushTitles } from '../titles.ts'

export const en: PushTitles = {
  noteFrom: (author) => `Note from ${author}`,
  noteFromColleague: 'Note from a colleague',
  draftWaiting: 'A draft is waiting for your approval',
  reviewWaiting: (channel) => `${channel} · An answer waits for your review`,
  notPosted: (channel) => `Not posted to Slack ${channel} · Open it to try again`,
  test: 'Homingbird test notification',
  testBody: 'Notifications reach this device.',
  deskStopped: 'Your cloud desk is no longer woken',
  deskStoppedBody: 'Homingbird stopped waking it. Open Nest → Connection to see why and set it up again.',
  deskUnavailable: 'Your agent cannot answer right now',
  deskUnavailableBody: {
    usage_limit: 'It reached its usage limit. Notes wait as delivered until it can answer again.',
    signed_out: 'It is signed out. Sign it in again on the computer your desk runs on.',
    failed: 'Its command keeps failing. Open Nest → Connection to see why.',
  },
  meeting: {
    colleague: 'A colleague',
    waits: (room) => `${room} · A time was found`,
    waitsBody: {
      send: 'Open it to send the invitation.',
      add: 'Open it to add the meeting to your calendar.',
    },
    added: (room) => `${room} · Added to your calendar`,
    addedBody: 'Your agent added the meeting. Open it to take it out.',
    cancelled: (room) => `${room} · Cancelled`,
    cancelledBody: 'Whoever opened the flock took the meeting out.',
    busy: (room, person) => `${room} · ${person} is busy then`,
    busyBody: 'Their calendar is taken at that time. Open it to find another time.',
    left: (room, person) => `${room} · ${person} left`,
    leftBody: {
      took_out: 'They took the meeting out. Open it to find another time.',
      declined: 'They cannot come. Open it to find another time.',
    },
    removeByHand: (room) => `${room} · Take it out yourself`,
    removeByHandBody: 'Your agent could not take the meeting out of your calendar.',
    joined: (room) => `${room} · Your agent is finding a time`,
    joinedBody: 'It joined for you to share your free times.',
    joinedFirstBody: (agent) =>
      `${agent} joined for you to share your free times. You can change this in Settings.`,
  },
}
