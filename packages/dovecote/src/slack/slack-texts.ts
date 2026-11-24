import { DEFAULT_LOCALE, type Locale } from '@homingbird/protocol'
import { escapeSlackText } from './slack-web-api.ts'

/** Rule 2: no message names a note, a draft's text or a colleague; a link carries the rest. */
export const slackTextsIn = (locale: Locale | null): SlackTexts => TEXTS[locale ?? DEFAULT_LOCALE]

export interface SlackTexts {
  readonly linkRequested: (email: string, url: string) => string
  readonly linkOffered: (url: string) => string
  readonly alreadyLinked: (name: string) => string
  readonly membersOnly: (team: string) => string
  readonly reviewWaiting: (url: string) => string
  readonly notPosted: (url: string) => string
  readonly linkStopped: string
  readonly channelLinkOffered: (url: string) => string
  readonly channelLinked: (channel: string) => string
  readonly sharedChannel: string
  readonly notLinkedHere: string
  readonly askerLimited: string
  readonly linkLimited: string
}

/** The address is the server's own and holds no `|` or `>`. */
export const slackLink = (url: string, label: string): string => `<${url}|${escapeSlackText(label)}>`

const en: SlackTexts = {
  linkRequested: (email, url) =>
    `Someone signed in to Homingbird as ${escapeSlackText(email)} asked to link this Slack user. If that was you, ${slackLink(url, 'open this link in Homingbird')} within 10 minutes. If not, ignore this message.`,
  linkOffered: (url) =>
    `To link your Slack user to Homingbird, ${slackLink(url, 'open this link')} while you are signed in to Homingbird, within 10 minutes.`,
  alreadyLinked: (name) =>
    `Your Slack user is linked to Homingbird as ${escapeSlackText(name)}. To change it, unlink it under Nest in Homingbird first.`,
  membersOnly: (team) => `Homingbird answers full members of ${escapeSlackText(team)} only.`,
  reviewWaiting: (url) => `A draft waits for your decision. ${slackLink(url, 'Open it in Homingbird')}`,
  notPosted: (url) =>
    `A reply could not be posted to Slack. ${slackLink(url, 'Open it in Homingbird')} to try again.`,
  linkStopped:
    'This channel’s link to Homingbird stopped, so questions here do not arrive. A manager of the Homingbird channel unlinks it there, invites the app here again and mentions @Homingbird with the word link.',
  channelLinkOffered: (url) =>
    `To link this channel to a Homingbird channel you manage, ${slackLink(url, 'open this link')} within 10 minutes and choose the channel.`,
  channelLinked: (channel) =>
    `This channel is linked to Homingbird ${escapeSlackText(channel)}. Mention @Homingbird with a question: its members read it there, and the answer a person approves is posted in the thread.`,
  sharedChannel: 'A channel shared with another organization cannot be linked to Homingbird.',
  notLinkedHere:
    'This channel is not linked to Homingbird. A manager of a Homingbird channel links it by mentioning @Homingbird with the word link.',
  askerLimited: 'You asked Homingbird 10 questions here in the last hour. Ask again later.',
  linkLimited: 'This channel asked Homingbird 200 questions today. Ask again tomorrow.',
}

const ko: SlackTexts = {
  linkRequested: (email, url) =>
    `Homingbird에 ${escapeSlackText(email)}(으)로 로그인한 사람이 이 Slack 사용자를 연결해 달라고 요청했습니다. 본인이라면 10분 안에 ${slackLink(url, 'Homingbird에서 이 링크를 여세요')}. 아니라면 이 메시지를 무시하세요.`,
  linkOffered: (url) =>
    `Slack 사용자를 Homingbird에 연결하려면 Homingbird에 로그인한 상태로 10분 안에 ${slackLink(url, '이 링크를 여세요')}.`,
  alreadyLinked: (name) =>
    `이 Slack 사용자는 Homingbird의 ${escapeSlackText(name)}에 연결되어 있습니다. 바꾸려면 먼저 Homingbird의 둥지에서 연결을 끊으세요.`,
  membersOnly: (team) => `Homingbird는 ${escapeSlackText(team)}의 정식 멤버에게만 답합니다.`,
  reviewWaiting: (url) => `결정을 기다리는 초안이 있습니다. ${slackLink(url, 'Homingbird에서 열기')}`,
  notPosted: (url) =>
    `답장을 Slack에 올리지 못했습니다. ${slackLink(url, 'Homingbird에서 열어')} 다시 시도하세요.`,
  linkStopped:
    '이 채널과 Homingbird의 연결이 멈춰서 이곳의 질문이 전달되지 않습니다. Homingbird 채널 운영자가 그곳에서 연결을 끊고, 앱을 이 채널에 다시 초대한 뒤 @Homingbird를 멘션하고 link라고 쓰면 됩니다.',
  channelLinkOffered: (url) =>
    `이 채널을 내가 운영하는 Homingbird 채널에 연결하려면 10분 안에 ${slackLink(url, '이 링크를 열고')} 채널을 고르세요.`,
  channelLinked: (channel) =>
    `이 채널은 Homingbird ${escapeSlackText(channel)}에 연결되었습니다. @Homingbird를 멘션해 질문하면 그 채널 멤버가 읽고, 사람이 승인한 답이 스레드에 올라옵니다.`,
  sharedChannel: '다른 조직과 공유한 채널은 Homingbird에 연결할 수 없습니다.',
  notLinkedHere:
    '이 채널은 Homingbird에 연결되어 있지 않습니다. Homingbird 채널 운영자가 @Homingbird를 멘션하고 link라고 쓰면 연결할 수 있습니다.',
  askerLimited: '지난 한 시간 동안 이곳에서 Homingbird에 10번 질문했습니다. 나중에 다시 질문하세요.',
  linkLimited: '이 채널은 오늘 Homingbird에 200번 질문했습니다. 내일 다시 질문하세요.',
}

const TEXTS: Readonly<Record<Locale, SlackTexts>> = { en, ko }
