import type { AsRead } from '@homingbird/protocol'
import { strings } from '../strings.ts'
import { dateTimeText } from './time.ts'

/** Slack under Connection: whether the server's workspace works, whom the person is linked to, and what to do. */
export const slackPersonModel = (input: SlackPersonInput): SlackPersonModel => {
  const mine = input.mine
  if (mine === undefined)
    return { loading: true, status: '', canConnect: false, canUnlink: false, requested: null }
  const link = mine.link
  return {
    loading: false,
    status:
      link !== null
        ? strings.slack.linked({ name: link.slackName, workspace: mine.team ?? '' })
        : mine.connected
          ? strings.slack.notLinked({ workspace: mine.team ?? '' })
          : strings.slack.notConnected,
    canConnect: link === null && mine.connected,
    canUnlink: link !== null,
    requested:
      input.requested === null
        ? null
        : input.requested
          ? strings.slack.requestSent
          : strings.slack.requestNotFound,
  }
}

export interface SlackPersonInput {
  /** Undefined while it loads. */
  readonly mine: AsRead.MeSlack | undefined
  /** Whether the last request found the person's Slack user; null before they ask. */
  readonly requested: boolean | null
}

export interface SlackPersonModel {
  readonly loading: boolean
  readonly status: string
  readonly canConnect: boolean
  readonly canUnlink: boolean
  readonly requested: string | null
}

/** The page a link from Slack opens: what confirming it does, or that the link no longer works. */
export const slackCodeModel = (code: AsRead.SlackCodeView | null | undefined): SlackCodeModel => {
  if (code === undefined) return { loading: true, question: null, refusal: null, channel: null }
  if (code !== null && code.kind === 'channel' && code.channel !== undefined) {
    const channel = code.channel
    return {
      loading: false,
      question: strings.slack.confirmChannel({ channel: channel.name, count: channel.memberCount ?? 0 }),
      refusal: channel.choices.length === 0 ? strings.slack.noChannelChoices : null,
      channel: { choices: channel.choices },
    }
  }
  if (code === null || code.kind !== 'person')
    return { loading: false, question: null, refusal: strings.slack.codeGone, channel: null }
  return {
    loading: false,
    question: strings.slack.confirmPerson({ name: code.slackName, workspace: code.team }),
    refusal: null,
    channel: null,
  }
}

export interface SlackCodeModel {
  readonly loading: boolean
  readonly question: string | null
  readonly refusal: string | null
  /** For a channel link: the channels the person may link the Slack channel to. */
  readonly channel: { readonly choices: ReadonlyArray<string> } | null
}

/** Slack on the administrator's settings page: the workspace's state and how to set the app up. */
export const adminSlackModel = (admin: AsRead.AdminSlack | undefined): AdminSlackModel | null => {
  if (admin === undefined) return null
  const workspace = admin.workspace
  return {
    status:
      workspace === null
        ? { text: strings.slack.admin.waiting, tone: 'is-waiting' }
        : workspace.state === 'connected'
          ? { text: strings.slack.admin.connected({ workspace: workspace.team }), tone: 'is-ok' }
          : { text: STOPPED_TEXTS[workspace.stoppedBecause ?? 'unknown'](), tone: 'is-stopped' },
    facts:
      workspace === null
        ? []
        : [
            {
              term: strings.slack.admin.lastEvent,
              value: dateTimeText(workspace.lastEventAt, strings.slack.admin.never),
            },
            { term: strings.slack.admin.linkedPeople, value: String(admin.linkedPeople) },
          ],
    eventsUrl: admin.eventsUrl,
    manifest: admin.manifest,
  }
}

export interface AdminSlackModel {
  readonly status: { readonly text: string; readonly tone: 'is-ok' | 'is-waiting' | 'is-stopped' }
  readonly facts: ReadonlyArray<{ readonly term: string; readonly value: string }>
  readonly eventsUrl: string
  readonly manifest: string
}

const STOPPED_TEXTS: Readonly<
  Record<NonNullable<AsRead.AdminSlack['workspace']>['stoppedBecause'] & string, () => string>
> = {
  token_refused: () => strings.slack.admin.stopped.tokenRefused,
  revoked: () => strings.slack.admin.stopped.revoked,
  other_workspace: () => strings.slack.admin.stopped.otherWorkspace,
  unknown: () => strings.slack.admin.stopped.unknown,
}
