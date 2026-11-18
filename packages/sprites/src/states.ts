import type { Frame } from './grid.ts'
import {
  BODY,
  DO_NOT_DISTURB,
  ENVELOPE,
  EYE,
  EYE_HAPPY,
  EYE_SHUT,
  EYE_SMALL,
  EYE_X,
  FEET,
  HEART,
  HEART_SMALL,
  KEY,
  LENS,
  MOON,
  PUFF,
  QUESTION,
  RED_X,
  STANDING,
  WINGS,
  badge,
  checkMark,
  confetti,
  dizzyStars,
  frame,
  mirror,
  sendingFrames,
  shift,
  sleepingZ,
  sparkle,
  spinner,
  tear,
  thinkingDots,
} from './pip-parts.ts'

/** Every state a client might show, in sprite-sheet order. Clients pick the ones their UI needs. */
export const STATES = {
  idle: [
    frame([...STANDING, ...EYE], 1400),
    frame([...STANDING, ...EYE_SHUT], 140),
    frame([...STANDING, ...EYE], 900),
    frame([...STANDING, ...EYE_SHUT], 140),
  ],
  offline: [
    frame([...STANDING, ...EYE_SHUT, ...sleepingZ(12, 0)], 700, 1),
    frame([...STANDING, ...EYE_SHUT], 700),
  ],
  away: [frame([...STANDING, ...EYE, ...MOON], 900), frame([...STANDING, ...EYE_SHUT, ...MOON], 160)],
  busy: [
    frame([...STANDING, ...EYE, ...DO_NOT_DISTURB], 900),
    frame([...STANDING, ...EYE_SHUT, ...DO_NOT_DISTURB], 160),
  ],
  connecting: [0, 1, 2, 3].map((step) => frame([...STANDING, ...EYE, ...spinner(step)], 160)),
  disconnected: [
    ...[7, 8, 9].map((y) => frame([...STANDING, ...EYE_SMALL, ...tear(y)], 260)),
    frame([...STANDING, ...EYE_SMALL], 400),
  ],
  drafting: [
    ...[1, 2, 3].map((count) => frame([...STANDING, ...EYE, ...thinkingDots(count)], 300)),
    frame([...STANDING, ...EYE], 300),
  ],
  'awaiting-approval': [
    frame([...STANDING, ...EYE, ...ENVELOPE, ...QUESTION], 500),
    frame([...STANDING, ...EYE, ...ENVELOPE], 300),
  ],
  approved: [
    frame([...STANDING, ...EYE_HAPPY, ...ENVELOPE], 160, 1),
    frame([...STANDING, ...EYE_HAPPY, ...ENVELOPE, ...checkMark('T')], 260),
    frame([...STANDING, ...EYE_HAPPY, ...ENVELOPE, ...checkMark('T')], 700),
  ],
  discarded: [
    frame([...STANDING, ...EYE, ...ENVELOPE], 300),
    frame([...STANDING, ...EYE, ...shift(ENVELOPE, 0, 2)], 160),
    frame([...STANDING, ...EYE_SHUT, ...PUFF], 220),
    frame([...STANDING, ...EYE], 600),
  ],
  sending: sendingFrames(),
  returning: sendingFrames().map((sent) => frame(mirror(sent.rects), sent.ms, sent.bob)),
  delivered: [
    frame([...STANDING, ...EYE, ...checkMark('M')], 900),
    frame([...STANDING, ...EYE_SHUT, ...checkMark('M')], 140),
  ],
  read: [
    frame([...STANDING, ...EYE_HAPPY, ...sparkle(2)], 220),
    frame([...STANDING, ...EYE_HAPPY, ...sparkle(1)], 220),
    frame([...STANDING, ...EYE_HAPPY], 220),
    frame([...STANDING, ...EYE_HAPPY, ...sparkle(1)], 220),
  ],
  'new-note': [
    frame([...STANDING, ...EYE, ...badge(0)], 160, 1),
    frame([...STANDING, ...EYE, ...badge(1)], 160),
    frame([...STANDING, ...EYE, ...badge(0)], 160),
    frame([...STANDING, ...EYE, ...badge(0)], 700),
  ],
  failed: [
    frame([...STANDING, ...EYE_X, ...shift(ENVELOPE, 0, 2), ...dizzyStars(0)], 220),
    frame([...STANDING, ...EYE_X, ...shift(ENVELOPE, 0, 2), ...dizzyStars(1)], 220),
  ],
  waving: [
    frame([...BODY, ...FEET, ...EYE_HAPPY, ...WINGS.up], 220),
    frame([...STANDING, ...EYE_HAPPY], 220),
  ],
  accepted: [
    frame([...STANDING, ...EYE_HAPPY, ...HEART], 300),
    frame([...STANDING, ...EYE_HAPPY, ...HEART_SMALL], 300),
  ],
  blocked: [frame([...STANDING, ...EYE, ...RED_X], 700), frame([...STANDING, ...EYE], 250)],
  searching: [0, -1, -2, -1].map((dx) => frame([...STANDING, ...EYE, ...shift(LENS, dx, 0)], 240)),
  'sign-in': [
    frame([...STANDING, ...EYE, ...KEY], 600),
    frame([...STANDING, ...EYE, ...shift(KEY, 0, 1)], 300),
  ],
  celebrate: [0, 1, 2, 3].map((phase) =>
    frame([...STANDING, ...EYE_HAPPY, ...confetti(phase)], 160, phase % 2),
  ),
} satisfies Record<string, ReadonlyArray<Frame>>

export type StateName = keyof typeof STATES

export const STATE_NAMES = Object.keys(STATES) as ReadonlyArray<StateName>

export const STATE_PURPOSE: Readonly<Record<StateName, string>> = {
  idle: 'Nothing happening. Blinks now and then.',
  offline: "The member's client is not connected. Asleep, a z blinking.",
  away: 'The member set themselves away.',
  busy: 'Do not disturb: notes queue silently.',
  connecting: 'Signing in, syncing, or reconnecting.',
  disconnected: 'Lost the connection to the server. A tear falls.',
  drafting: 'An agent is writing a note or a reply draft. Also the typing indicator the other side sees.',
  'awaiting-approval': 'A draft is waiting for its human to approve it.',
  approved: 'The human approved the draft. A hop and a check.',
  discarded: 'The human threw the draft away. The envelope drops and puffs out.',
  sending: 'Approved note on its way out.',
  returning: 'A reply is on its way back (Pip flies home, facing left).',
  delivered: 'The note reached the recipient. Grey check.',
  read: 'The recipient read the note.',
  'new-note': 'A note arrived. Badge bounces.',
  failed: 'The note could not be delivered. Dizzy, envelope dropped.',
  waving: 'Hello: onboarding, or a contact request in contacts mode.',
  accepted: 'A contact request was accepted.',
  blocked: 'This member cannot be messaged, or you blocked them. A red badge with a white X blinks.',
  searching: 'Looking through the directory for a colleague.',
  'sign-in': 'Needs sign-in or a credential approval (device code).',
  celebrate: 'A first: first note sent, setup finished.',
}
