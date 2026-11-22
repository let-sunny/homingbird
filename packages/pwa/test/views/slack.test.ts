import { lifetime } from '@homingbird/ui'
import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { adminSlackSection, slackLinkView, slackSection } from '../../src/views/slack.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const MINE = { team: 'Acme', connected: true, link: null }
const CODE = 'a'.repeat(43)

describe('slackSection', () => {
  it('loads the link, asks Slack for one and says what the request found', () => {
    const { context, called } = testContext()
    const shown = mount(slackSection(context, lifetime()))
    expect(textOf(shown)).toContain(strings.loading)
    called('loadMySlack')[0]!.then!.done!(MINE)
    expect(textOf(shown)).toContain(strings.slack.notLinked({ workspace: 'Acme' }))
    getByRole(shown, 'button', { name: strings.slack.connect }).click()
    called('connectSlack')[0]!.then!.done!(false)
    expect(textOf(shown)).toContain(strings.slack.requestNotFound)
  })

  it('unlinks after asking, then reads the link again', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    const shown = mount(slackSection(context, lifetime()))
    called('loadMySlack')[0]!.then!.done!({ ...MINE, link: { slackName: 'Ana', linkedAt: 1 } })
    expect(textOf(shown)).toContain(strings.slack.linked({ name: 'Ana', workspace: 'Acme' }))
    getByRole(shown, 'button', { name: strings.slack.unlink }).click()
    const dialog = document.getElementById('dialog')!
    expect(textOf(dialog)).toContain(strings.slack.unlinkBody)
    getByRole(dialog, 'button', { name: strings.slack.unlink }).click()
    called('unlinkSlack')[0]!.then!.done!(undefined)
    expect(called('loadMySlack')).toHaveLength(2)
    called('loadMySlack')[1]!.then!.done!(MINE)
    expect(textOf(shown)).toContain(strings.slack.notLinked({ workspace: 'Acme' }))
  })
})

describe('slackLinkView', () => {
  it('asks before linking the Slack user a code names, then goes back to Connection', () => {
    const { context, called, page } = testContext()
    const shown = mount(slackLinkView(context, lifetime(), CODE))
    expect(called('readSlackCode')[0]!.args).toEqual([CODE])
    called('readSlackCode')[0]!.then!.done!({ kind: 'person', slackName: 'Ana', team: 'Acme', expiresAt: 1 })
    expect(textOf(shown)).toContain(strings.slack.confirmPerson({ name: 'Ana', workspace: 'Acme' }))
    getByRole(shown, 'button', { name: strings.slack.confirm }).click()
    expect(called('linkSlack')[0]!.args).toEqual([CODE])
    called('linkSlack')[0]!.then!.done!(MINE)
    expect(page.state.hash).toBe('#/agent/connection')
  })

  it('links a Slack channel to the channel the person chooses, then opens it', () => {
    const { context, called, page } = testContext()
    const shown = mount(slackLinkView(context, lifetime(), CODE))
    called('readSlackCode')[0]!.then!.done!({
      kind: 'channel',
      slackName: 'Ana',
      team: 'Acme',
      expiresAt: 1,
      channel: { name: 'billing-help', isPrivate: false, memberCount: 12, choices: ['billing', 'refunds'] },
    })
    expect(textOf(shown)).toContain(strings.slack.confirmChannel({ channel: 'billing-help', count: 12 }))
    expect(textOf(shown)).toContain(strings.slack.confirmChannelHint)
    getByRole(shown, 'button', { name: strings.slack.confirm }).click()
    expect(called('linkSlackChannel')[0]!.args).toEqual(['billing', CODE])
    called('linkSlackChannel')[0]!.then!.done!({ slug: 'billing' })
    expect(page.state.hash).toBe('#/channel/billing')
  })

  it('says when there is no channel to link a Slack channel to', () => {
    const { context, called } = testContext()
    const shown = mount(slackLinkView(context, lifetime(), CODE))
    called('readSlackCode')[0]!.then!.done!({
      kind: 'channel',
      slackName: 'Ana',
      team: 'Acme',
      expiresAt: 1,
      channel: { name: 'payroll', isPrivate: true, memberCount: 4, choices: [] },
    })
    expect(textOf(shown)).toContain(strings.slack.noChannelChoices)
    expect(shown.querySelector('select')).toBeNull()
  })

  it('says a link that no longer works is gone', () => {
    const { context, called } = testContext()
    const shown = mount(slackLinkView(context, lifetime(), CODE))
    expect(textOf(shown)).toContain(strings.loading)
    called('readSlackCode')[0]!.then!.failed!({ _tag: 'NotFound', message: 'gone' })
    expect(textOf(shown)).toContain(strings.slack.codeGone)
    expect(getByRole(shown, 'link', { name: strings.slack.toConnection })).toBeTruthy()
  })
})

describe('adminSlackSection', () => {
  it('shows the workspace’s state, the events address and the manifest to copy', () => {
    const { context, called } = testContext()
    const shown = mount(adminSlackSection(context, lifetime()))
    expect(textOf(shown)).toContain(strings.loading)
    called('loadAdminSlack')[0]!.then!.done!({
      workspace: {
        team: 'Acme',
        state: 'connected',
        stoppedBecause: null,
        connectedAt: 1,
        lastEventAt: null,
      },
      eventsUrl: 'https://hb.example/slack/events',
      manifest: '{"a":1}',
      linkedPeople: 2,
    })
    expect(textOf(shown)).toContain(strings.slack.admin.connected({ workspace: 'Acme' }))
    expect((shown.querySelector('.slack-manifest') as HTMLTextAreaElement).value).toBe('{"a":1}')
    expect((shown.querySelector('.slack-events-url') as HTMLInputElement).value).toBe(
      'https://hb.example/slack/events',
    )
    expect(textOf(shown)).toContain(strings.slack.admin.linkedPeople)
  })

  it('lists no facts before the server reached Slack', () => {
    const { context, called } = testContext()
    const shown = mount(adminSlackSection(context, lifetime()))
    called('loadAdminSlack')[0]!.then!.done!({
      workspace: null,
      eventsUrl: 'x',
      manifest: '{}',
      linkedPeople: 0,
    })
    expect(shown.querySelector('.facts')).toBeNull()
    expect(textOf(shown)).toContain(strings.slack.admin.waiting)
  })
})
