import type { AsRead } from '@homingbird/protocol'
import { strings } from '../strings.ts'
import { dateTimeText } from './time.ts'

/**
 * Slack under Connection: whether the server's workspace works, whom the person is linked to, and what to
 * do. Slack stopped on the server says so and why, even with a link, since nothing reaches them there.
 */
export const slackPersonModel = (input: SlackPersonInput): SlackPersonModel => {
  const mine = input.mine
  if (mine === undefined)
    return { loading: true, status: '', canConnect: false, canUnlink: false, stopped: null, requested: null }
  const link = mine.link
  const stopped = mine.connected || mine.stopped == null ? null : PERSON_STOPPED_TEXTS[mine.stopped]()
  return {
    loading: false,
    status:
      link !== null
        ? strings.slack.linked({ name: link.slackName, workspace: mine.team ?? '' })
        : mine.connected
          ? strings.slack.notLinked({ workspace: mine.team ?? '' })
          : (stopped ?? strings.slack.notConnected),
    stopped: link === null ? null : stopped,
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
  /** Under a link: why Slack does not work on the server, when it stopped. */
  readonly stopped: string | null
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

/**
 * Slack on the administrator's settings page: the workspace's state, how to set the app up, and where its
 * bot token and signing secret come from. Values in the server's environment cannot be changed here.
 */
export const adminSlackModel = (admin: AsRead.AdminSlack | undefined): AdminSlackModel | null => {
  if (admin === undefined) return null
  const workspace = admin.workspace
  const hasValues = admin.credentials.source !== 'none'
  return {
    status: !hasValues
      ? { text: strings.slack.admin.enterValues, tone: 'is-waiting' }
      : workspace === null
        ? admin.tokenRefused === true
          ? { text: strings.slack.admin.tokenRefused, tone: 'is-stopped' }
          : { text: strings.slack.admin.waiting, tone: 'is-waiting' }
        : workspace.state === 'connected'
          ? { text: strings.slack.admin.connected({ workspace: workspace.team }), tone: 'is-ok' }
          : { text: STOPPED_TEXTS[workspace.stoppedBecause ?? 'unknown'](), tone: 'is-stopped' },
    facts:
      workspace === null || !hasValues
        ? []
        : [
            {
              term: strings.slack.admin.lastEvent,
              value: dateTimeText(workspace.lastEventAt, strings.slack.admin.never),
            },
            { term: strings.slack.admin.linkedPeople, value: String(admin.linkedPeople) },
          ],
    credentials: credentialsOf(admin.credentials),
    eventsUrl: admin.eventsUrl,
    manifest: admin.manifest,
  }
}

export interface AdminSlackModel {
  readonly status: { readonly text: string; readonly tone: 'is-ok' | 'is-waiting' | 'is-stopped' }
  readonly facts: ReadonlyArray<{ readonly term: string; readonly value: string }>
  readonly credentials: AdminSlackCredentialsModel
  readonly eventsUrl: string
  readonly manifest: string
}

/** Where the app's values come from, and the form that gives, replaces or removes them when it may. */
export interface AdminSlackCredentialsModel {
  readonly note: string
  readonly form: { readonly submit: string; readonly canRemove: boolean } | null
}

const credentialsOf = (credentials: AsRead.AdminSlack['credentials']): AdminSlackCredentialsModel => {
  const texts = strings.slack.admin.credentials
  if (credentials.source === 'environment') return { note: texts.fromEnvironment, form: null }
  if (credentials.source === 'unknown') return { note: texts.unknown, form: null }
  if (!credentials.canStore) return { note: texts.noKey, form: null }
  if (credentials.source === 'none')
    return { note: texts.kept, form: { submit: texts.save, canRemove: false } }
  return {
    note: texts.storedAt({ when: dateTimeText(credentials.storedAt, strings.slack.admin.never) }),
    form: { submit: texts.replace, canRemove: true },
  }
}

const PERSON_STOPPED_TEXTS: Readonly<Record<NonNullable<AsRead.MeSlack['stopped']>, () => string>> = {
  token_refused: () => strings.slack.stopped.tokenRefused,
  revoked: () => strings.slack.stopped.revoked,
  other_workspace: () => strings.slack.stopped.otherWorkspace,
  unknown: () => strings.slack.stopped.unknown,
}

const STOPPED_TEXTS: Readonly<
  Record<NonNullable<AsRead.AdminSlack['workspace']>['stoppedBecause'] & string, () => string>
> = {
  token_refused: () => strings.slack.admin.stopped.tokenRefused,
  revoked: () => strings.slack.admin.stopped.revoked,
  other_workspace: () => strings.slack.admin.stopped.otherWorkspace,
  unknown: () => strings.slack.admin.stopped.unknown,
}
