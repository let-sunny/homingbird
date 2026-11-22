import { describe, expect, it } from 'vitest'
import * as tasks from '../../src/tasks/slack.ts'
import { testApp } from '../support/app.ts'

const MINE = { team: 'Acme', connected: true, link: null }
const CODE = 'a'.repeat(43)

describe('Slack tasks', () => {
  it('reads the person’s link, asks for one, reads and confirms a code, and unlinks', async () => {
    const { run, routes, sent } = testApp({
      'me.slack.get': () => MINE,
      'me.slack.connect': () => ({ sent: true }),
      'slack.codes.get': () => ({ kind: 'person', slackName: 'Ana', team: 'Acme', expiresAt: 1 }),
      'me.slack.link': () => ({ ...MINE, link: { slackName: 'Ana', linkedAt: 1 } }),
      'admin.slack.get': () => ({ workspace: null, eventsUrl: 'x', manifest: '{}', linkedPeople: 0 }),
    })
    expect(await run(tasks.loadMySlack)).toMatchObject({ _tag: 'Ok', value: MINE })
    expect(await run(tasks.connectSlack)).toMatchObject({ _tag: 'Ok', value: true })
    expect(await run(tasks.readSlackCode(CODE))).toMatchObject({ _tag: 'Ok', value: { slackName: 'Ana' } })
    expect(await run(tasks.linkSlack(CODE))).toMatchObject({
      _tag: 'Ok',
      value: { link: { slackName: 'Ana' } },
    })
    await run(tasks.unlinkSlack)
    expect(await run(tasks.loadAdminSlack)).toMatchObject({ _tag: 'Ok', value: { linkedPeople: 0 } })
    expect(routes()).toEqual([
      'me.slack.get',
      'me.slack.connect',
      'slack.codes.get',
      'me.slack.link',
      'me.slack.unlink',
      'admin.slack.get',
    ])
    expect(sent[1]!.request).toEqual({ body: {} })
    expect(sent[2]!.request).toEqual({ params: { id: CODE } })
    expect(sent[3]!.request).toEqual({ body: { code: CODE } })
  })
})

describe('Slack channel tasks', () => {
  it('links and unlinks a channel, and tries a post again', async () => {
    const { run, routes, sent } = testApp({
      'channels.slack.link': () => ({ slug: 'billing' }),
      'notes.posting.retry': () => ({ id: 'note_1', conversationId: 'conv_1', posting: 'pending' }),
    })
    expect(await run(tasks.linkSlackChannel('billing', CODE))).toMatchObject({
      _tag: 'Ok',
      value: { slug: 'billing' },
    })
    await run(tasks.unlinkSlackChannel('billing'))
    await run(tasks.retrySlackPost('note_1' as never))
    expect(routes()).toEqual(['channels.slack.link', 'channels.slack.unlink', 'notes.posting.retry'])
    expect(sent[0]!.request).toEqual({ params: { slug: 'billing' }, body: { code: CODE } })
    expect(sent[2]!.request).toEqual({ params: { id: 'note_1' }, body: {} })
  })
})
