import type { AsRead } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { adminSlackModel, slackCodeModel, slackPersonModel } from '../../src/models/slack.ts'
import { dateTimeText } from '../../src/models/time.ts'
import { strings } from '../../src/strings.ts'

const MINE: AsRead.MeSlack = { team: 'Acme', connected: true, link: null }

const WORKSPACE: NonNullable<AsRead.AdminSlack['workspace']> = {
  team: 'Acme',
  state: 'connected',
  stoppedBecause: null,
  connectedAt: 1,
  lastEventAt: null,
}

const adminOf = (workspace: AsRead.AdminSlack['workspace']): AsRead.AdminSlack => ({
  workspace,
  eventsUrl: 'https://hb.example/slack/events',
  manifest: '{"a":1}',
  linkedPeople: 3,
})

describe('slackPersonModel', () => {
  it('waits while the link loads', () => {
    expect(slackPersonModel({ mine: undefined, requested: null })).toEqual({
      loading: true,
      status: '',
      canConnect: false,
      canUnlink: false,
      requested: null,
    })
  })

  it('offers to connect a person not linked yet, and says what their request found', () => {
    expect(slackPersonModel({ mine: MINE, requested: null })).toEqual({
      loading: false,
      status: strings.slack.notLinked({ workspace: 'Acme' }),
      canConnect: true,
      canUnlink: false,
      requested: null,
    })
    expect(slackPersonModel({ mine: MINE, requested: true }).requested).toBe(strings.slack.requestSent)
    expect(slackPersonModel({ mine: MINE, requested: false }).requested).toBe(strings.slack.requestNotFound)
  })

  it('names no workspace when the server has not learned its name', () => {
    expect(slackPersonModel({ mine: { ...MINE, team: null }, requested: null }).status).toBe(
      strings.slack.notLinked({ workspace: '' }),
    )
  })

  it('names the Slack user a person is linked to, and offers to unlink', () => {
    const linked = slackPersonModel({
      mine: { ...MINE, link: { slackName: 'Ana', linkedAt: 1 } },
      requested: null,
    })
    expect(linked).toMatchObject({
      status: strings.slack.linked({ name: 'Ana', workspace: 'Acme' }),
      canConnect: false,
      canUnlink: true,
    })
  })

  it('says Slack is not connected, and still lets a linked person unlink', () => {
    expect(
      slackPersonModel({ mine: { team: null, connected: false, link: null }, requested: null }),
    ).toMatchObject({
      status: strings.slack.notConnected,
      canConnect: false,
      canUnlink: false,
    })
    const stopped = slackPersonModel({
      mine: { team: null, connected: false, link: { slackName: 'Ana', linkedAt: 1 } },
      requested: null,
    })
    expect(stopped).toMatchObject({
      status: strings.slack.linked({ name: 'Ana', workspace: '' }),
      canUnlink: true,
    })
  })
})

describe('slackCodeModel', () => {
  it('waits, asks what confirming links, or says the link is gone', () => {
    expect(slackCodeModel(undefined)).toEqual({ loading: true, question: null, refusal: null, channel: null })
    expect(slackCodeModel({ kind: 'person', slackName: 'Ana', team: 'Acme', expiresAt: 1 })).toEqual({
      loading: false,
      question: strings.slack.confirmPerson({ name: 'Ana', workspace: 'Acme' }),
      refusal: null,
      channel: null,
    })
    expect(slackCodeModel(null)).toEqual({
      loading: false,
      question: null,
      refusal: strings.slack.codeGone,
      channel: null,
    })
    expect(slackCodeModel({ kind: 'unknown', slackName: 'Ana', team: 'Acme', expiresAt: 1 }).refusal).toBe(
      strings.slack.codeGone,
    )
  })
})

describe('slackCodeModel for a channel', () => {
  const code = (choices: ReadonlyArray<string>, memberCount: number | null = 12) =>
    slackCodeModel({
      kind: 'channel',
      slackName: 'Ana',
      team: 'Acme',
      expiresAt: 1,
      channel: { name: 'billing-help', isPrivate: false, memberCount, choices },
    })

  it('asks which channel to link the Slack channel to', () => {
    expect(code(['billing'])).toEqual({
      loading: false,
      question: strings.slack.confirmChannel({ channel: 'billing-help', count: 12 }),
      refusal: null,
      channel: { choices: ['billing'] },
    })
  })

  it('says when the person manages no channel it may link to', () => {
    expect(code([], null)).toMatchObject({
      question: strings.slack.confirmChannel({ channel: 'billing-help', count: 0 }),
      refusal: strings.slack.noChannelChoices,
      channel: { choices: [] },
    })
  })
})

describe('adminSlackModel', () => {
  it('shows nothing while it loads, and says when the server has not reached Slack yet', () => {
    expect(adminSlackModel(undefined)).toBeNull()
    expect(adminSlackModel(adminOf(null))).toEqual({
      status: { text: strings.slack.admin.waiting, tone: 'is-waiting' },
      facts: [],
      eventsUrl: 'https://hb.example/slack/events',
      manifest: '{"a":1}',
    })
  })

  it('names the connected workspace, when Slack last sent an event and how many people are linked', () => {
    expect(adminSlackModel(adminOf({ ...WORKSPACE, lastEventAt: 5 }))).toMatchObject({
      status: { text: strings.slack.admin.connected({ workspace: 'Acme' }), tone: 'is-ok' },
      facts: [
        { term: strings.slack.admin.lastEvent, value: dateTimeText(5, strings.slack.admin.never) },
        { term: strings.slack.admin.linkedPeople, value: '3' },
      ],
    })
  })

  it('says why Slack stopped', () => {
    const stoppedFor = (stoppedBecause: NonNullable<AsRead.AdminSlack['workspace']>['stoppedBecause']) =>
      adminSlackModel(adminOf({ ...WORKSPACE, state: 'stopped', stoppedBecause }))!.status
    expect(stoppedFor('token_refused')).toEqual({
      text: strings.slack.admin.stopped.tokenRefused,
      tone: 'is-stopped',
    })
    expect(stoppedFor('revoked').text).toBe(strings.slack.admin.stopped.revoked)
    expect(stoppedFor('other_workspace').text).toBe(strings.slack.admin.stopped.otherWorkspace)
    expect(stoppedFor('unknown').text).toBe(strings.slack.admin.stopped.unknown)
    expect(stoppedFor(null).text).toBe(strings.slack.admin.stopped.unknown)
  })
})
