import { NOTE_BODY_MAX } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DELETED_IN_SLACK, mentionedUsers, plainFromSlack, slackPostOf } from '../src/slack/slack-markup.ts'

const NAMES = new Map([['U1', 'Ana']])

describe('a Slack message as a note', () => {
  it('removes the app’s mention and names the people, channels and groups it mentions', () => {
    expect(plainFromSlack('<@UBOT> ask <@U1> or <@U2|bob>', NAMES, 'UBOT')).toBe('ask @Ana or @someone')
    expect(plainFromSlack('in <#C1|general> and <#C2>', NAMES, 'UBOT')).toBe('in #general and #channel')
    expect(plainFromSlack('<!here> <!channel|channel> <!everyone>', NAMES, 'UBOT')).toBe(
      '@here @channel @everyone',
    )
    expect(plainFromSlack('<!subteam^S1|@billing> <!subteam^S2>', NAMES, 'UBOT')).toBe('@billing @group')
    expect(plainFromSlack('<!date^1700000000^{date}|Nov 14>', NAMES, 'UBOT')).toBe('Nov 14')
  })

  it('shows a link’s address beside its label, and undoes Slack’s escapes', () => {
    expect(plainFromSlack('<https://a.example|docs> <https://b.example|https://b.example>', NAMES, 'U')).toBe(
      'docs (https://a.example) https://b.example',
    )
    expect(plainFromSlack('<mailto:ana@example.com> &lt;b&gt; &amp;', NAMES, 'U')).toBe(
      'mailto:ana@example.com <b> &',
    )
  })

  it('cuts a message longer than a note, and says so', () => {
    const plain = plainFromSlack('x'.repeat(NOTE_BODY_MAX + 10), NAMES, 'U')
    expect(plain).toHaveLength(NOTE_BODY_MAX)
    expect(plain.endsWith('[Cut: the message was longer than a note.]')).toBe(true)
  })

  it('lists at most five people a message mentions, once each, without the app', () => {
    expect(mentionedUsers('<@UBOT> <@U1> <@U1> <@U2|b> <@U3> <@U4> <@U5> <@U6>', 'UBOT')).toEqual([
      'U1',
      'U2',
      'U3',
      'U4',
      'U5',
    ])
  })
})

describe('a note as the app posts it', () => {
  it('puts who wrote and approved it first, and escapes both so nothing pings, mentions or disguises a link', () => {
    expect(
      slackPostOf('Billing helper, approved by Ana', 'See <!channel> & <https://evil.example|bank>'),
    ).toBe('Billing helper, approved by Ana\nSee &lt;!channel&gt; &amp; &lt;https://evil.example|bank&gt;')
    expect(DELETED_IN_SLACK).toBe('Deleted in Slack.')
  })

  it('never lets a note open one of Slack’s special forms, whatever it says', () => {
    fc.assert(
      fc.property(fc.string(), (body) => {
        expect(slackPostOf('Ana', body)).not.toMatch(/[<>]/)
      }),
    )
  })
})
