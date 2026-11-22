import { describe, expect, it } from 'vitest'
import {
  AdminSlack,
  MeSlack,
  SLACK_BOT_EVENTS,
  SLACK_BOT_SCOPES,
  SLACK_CODE_LIFETIME_MS,
  SLACK_EVENTS_PATH,
  SLACK_THREAD_MOVED,
  SlackCodeView,
  SlackCredentials,
  SlackCredentialsInput,
  SlackLinkCode,
  SlackWorkspace,
  slackCodeHref,
  slackManifest,
} from '../src/slack.ts'

const WORKSPACE = {
  team: 'Acme',
  state: 'connected',
  stoppedBecause: null,
  connectedAt: 1,
  lastEventAt: null,
}

describe('the Slack connection as clients read it', () => {
  it('reads a state or a reason to stop that a newer server added as unknown', () => {
    const read = SlackWorkspace.read({ ...WORKSPACE, state: 'paused', stoppedBecause: 'tired' })
    expect(read._tag === 'Ok' && read.value.state).toBe('unknown')
    expect(read._tag === 'Ok' && read.value.stoppedBecause).toBe('unknown')
    expect(SlackWorkspace.decode({ ...WORKSPACE, state: 'paused' })._tag).toBe('Err')
  })

  it('names the workspace, the events address and the manifest for an administrator', () => {
    const admin = {
      workspace: WORKSPACE,
      credentials: { source: 'stored', canStore: true, storedAt: 1 },
      eventsUrl: 'https://hb.example/slack/events',
      manifest: '{}',
      linkedPeople: 2,
    }
    expect(AdminSlack.decode(admin)._tag).toBe('Ok')
    expect(AdminSlack.decode({ ...admin, linkedPeople: -1 })._tag).toBe('Err')
  })

  it('reads where the app’s values come from as unknown when a newer server names another place', () => {
    const read = SlackCredentials.read({ source: 'vault', canStore: false, storedAt: null })
    expect(read._tag === 'Ok' && read.value.source).toBe('unknown')
    expect(SlackCredentials.decode({ source: 'vault', canStore: false, storedAt: null })._tag).toBe('Err')
  })

  it('takes only a bot token and a hexadecimal signing secret of the lengths Slack issues', () => {
    const values = { botToken: 'xoxb-1234-5678-abcdefgh', signingSecret: 'abcdef0123456789' }
    expect(SlackCredentialsInput.decode(values)._tag).toBe('Ok')
    for (const botToken of [
      'xoxp-1234-5678-abcdefgh',
      'xoxb-short',
      ` ${values.botToken}`,
      `${values.botToken}!`,
    ])
      expect([botToken, SlackCredentialsInput.decode({ ...values, botToken })._tag]).toEqual([
        botToken,
        'Err',
      ])
    for (const signingSecret of [
      'abcdef012345678',
      'abcdef0123456789z',
      ' abcdef0123456789',
      'a'.repeat(129),
    ])
      expect([signingSecret, SlackCredentialsInput.decode({ ...values, signingSecret })._tag]).toEqual([
        signingSecret,
        'Err',
      ])
    expect(SlackCredentialsInput.decode({ ...values, signingSecret: 'A'.repeat(128) })._tag).toBe('Ok')
    expect(SlackCredentialsInput.decode({ ...values, botToken: `xoxb-${'a'.repeat(250)}` })._tag).toBe('Ok')
    expect(SlackCredentialsInput.decode({ ...values, botToken: `xoxb-${'a'.repeat(251)}` })._tag).toBe('Err')
  })

  it('tells a person whether Slack is connected and whom they are linked to', () => {
    expect(MeSlack.decode({ team: null, connected: false, link: null })._tag).toBe('Ok')
    expect(
      MeSlack.decode({ team: 'Acme', connected: true, link: { slackName: 'Ana', linkedAt: 5 } })._tag,
    ).toBe('Ok')
  })

  it('reads a code of a kind it does not know as unknown', () => {
    const read = SlackCodeView.read({ kind: 'room', slackName: 'Ana', team: 'Acme', expiresAt: 1 })
    expect(read._tag === 'Ok' && read.value.kind).toBe('unknown')
  })

  it('describes a channel link’s code with the Slack channel and the channels it may link to', () => {
    const view = {
      kind: 'channel',
      slackName: 'Ana',
      team: 'Acme',
      expiresAt: 1,
      channel: { name: 'billing-help', isPrivate: false, memberCount: 12, choices: ['billing'] },
    }
    expect(SlackCodeView.decode(view)._tag).toBe('Ok')
    expect(SLACK_THREAD_MOVED).toBe('The Slack thread has newer messages. Read them, then send again.')
  })

  it('takes a link code of URL-safe characters only', () => {
    expect(SlackLinkCode.decode('a'.repeat(43))._tag).toBe('Ok')
    expect(SlackLinkCode.decode('short')._tag).toBe('Err')
    expect(SlackLinkCode.decode(`${'a'.repeat(30)}/x`)._tag).toBe('Err')
  })

  it('makes a code’s web client address and keeps it for ten minutes', () => {
    expect(slackCodeHref('abc_DEF-123')).toBe('#/slack/link/abc_DEF-123')
    expect(slackCodeHref('a b')).toBe('#/slack/link/a%20b')
    expect(SLACK_CODE_LIFETIME_MS).toBe(600_000)
  })
})

describe('the Slack app manifest', () => {
  it('points the events at this server and asks for the bot scopes and events only', () => {
    const manifest = JSON.parse(slackManifest('https://hb.example.com'))
    expect(SLACK_EVENTS_PATH).toBe('/slack/events')
    expect(manifest.settings.event_subscriptions.request_url).toBe('https://hb.example.com/slack/events')
    expect(manifest.oauth_config.scopes).toEqual({ bot: [...SLACK_BOT_SCOPES] })
    expect(manifest.settings.event_subscriptions.bot_events).toEqual([...SLACK_BOT_EVENTS])
    expect(manifest.settings).toMatchObject({
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    })
    expect(manifest.features.bot_user).toEqual({ display_name: 'Homingbird', always_online: true })
    expect(manifest.display_information.name).toBe('Homingbird')
  })

  it('asks for no user scope, and no scope that posts as someone else or reads direct messages', () => {
    const manifest = JSON.parse(slackManifest('https://hb.example.com'))
    expect(manifest.oauth_config.scopes.user).toBeUndefined()
    expect(SLACK_BOT_SCOPES).not.toContain('chat:write.customize')
    expect(SLACK_BOT_SCOPES).not.toContain('im:history')
  })
})
