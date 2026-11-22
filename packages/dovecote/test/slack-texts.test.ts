import { LOCALES } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { slackLink, slackTextsIn } from '../src/slack/slack-texts.ts'

const URL = 'https://hb.example.com/#/slack/link/abc'

describe('what the app says in Slack', () => {
  it('says it in the person’s language, and in English when Homingbird does not know it', () => {
    expect(slackTextsIn(null).reviewWaiting(URL)).toBe(slackTextsIn('en').reviewWaiting(URL))
    expect(slackTextsIn('ko').reviewWaiting(URL)).toContain('초안')
  })

  it('escapes every name and address it repeats, so none can mention, ping or disguise a link', () => {
    for (const locale of LOCALES) {
      const texts = slackTextsIn(locale)
      for (const text of [
        texts.linkRequested('<!channel>@example.com', URL),
        texts.alreadyLinked('<@U1>'),
        texts.membersOnly('<https://evil.example|Acme>'),
      ]) {
        expect(text).not.toMatch(/<[!@]/)
        expect(text).not.toContain('<https://evil')
      }
      expect(texts.linkOffered(URL)).toContain(`<${URL}|`)
    }
  })

  it('says nothing about a draft but that one waits, with a link to it', () => {
    for (const locale of LOCALES)
      expect(slackTextsIn(locale).reviewWaiting(URL)).toMatch(new RegExp(`<${URL}\\|[^>]+>$`))
    expect(slackLink(URL, 'a <b> & c')).toBe(`<${URL}|a &lt;b&gt; &amp; c>`)
  })
})
