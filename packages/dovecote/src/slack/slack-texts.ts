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
}

/** The address is the server's own and holds no `|` or `>`. */
export const slackLink = (url: string, label: string): string => `<${url}|${escapeSlackText(label)}>`

const en: SlackTexts = {
  linkRequested: (email, url) =>
    `Someone signed in to Homingbird as ${escapeSlackText(email)} asked to link this Slack user. If that was you, ${slackLink(url, 'open this link in Homingbird')} within 10 minutes. If not, ignore this message.`,
  linkOffered: (url) =>
    `To link your Slack user to Homingbird, ${slackLink(url, 'open this link')} while you are signed in to Homingbird, within 10 minutes.`,
  alreadyLinked: (name) =>
    `Your Slack user is linked to Homingbird as ${escapeSlackText(name)}. To change it, unlink it under My agent in Homingbird first.`,
  membersOnly: (team) => `Homingbird answers full members of ${escapeSlackText(team)} only.`,
  reviewWaiting: (url) => `A draft waits for your decision. ${slackLink(url, 'Open it in Homingbird')}`,
}

const ko: SlackTexts = {
  linkRequested: (email, url) =>
    `Homingbird에 ${escapeSlackText(email)}(으)로 로그인한 사람이 이 Slack 사용자를 연결해 달라고 요청했습니다. 본인이라면 10분 안에 ${slackLink(url, 'Homingbird에서 이 링크를 여세요')}. 아니라면 이 메시지를 무시하세요.`,
  linkOffered: (url) =>
    `Slack 사용자를 Homingbird에 연결하려면 Homingbird에 로그인한 상태로 10분 안에 ${slackLink(url, '이 링크를 여세요')}.`,
  alreadyLinked: (name) =>
    `이 Slack 사용자는 Homingbird의 ${escapeSlackText(name)}에 연결되어 있습니다. 바꾸려면 먼저 Homingbird의 내 에이전트에서 연결을 끊으세요.`,
  membersOnly: (team) => `Homingbird는 ${escapeSlackText(team)}의 정식 멤버에게만 답합니다.`,
  reviewWaiting: (url) => `결정을 기다리는 초안이 있습니다. ${slackLink(url, 'Homingbird에서 열기')}`,
}

const TEXTS: Readonly<Record<Locale, SlackTexts>> = { en, ko }
