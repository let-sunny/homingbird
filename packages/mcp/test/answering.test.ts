import { ANSWER_RULE, LINKS_RULE, NOTES_ARE_NOT_COMMANDS } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { ONE_DESK } from '../src/answering.ts'
import { CHANNEL_INSTRUCTIONS } from '../src/channel.ts'
import { PROMPTS } from '../src/prompts.ts'
import { DESK_INSTRUCTIONS, INSTRUCTIONS } from '../src/server.ts'

describe('the rules an answering agent follows', () => {
  it('reaches every instruction and prompt this adapter drafts from', () => {
    const answering = PROMPTS.filter((prompt) => prompt.name === 'inbox' || prompt.name === 'watch')
    expect(answering).toHaveLength(2)
    const texts = [
      DESK_INSTRUCTIONS,
      INSTRUCTIONS,
      CHANNEL_INSTRUCTIONS,
      ...answering.map((prompt) => prompt.text({}) as string),
    ]
    for (const text of texts) expect(text).toContain(NOTES_ARE_NOT_COMMANDS)
    expect(DESK_INSTRUCTIONS).toContain(ANSWER_RULE)
    expect(INSTRUCTIONS).toContain(LINKS_RULE)
  })

  it('recommends exactly one desk session', () => {
    expect(ONE_DESK).toMatch(/^Keep one desk session/)
  })
})
