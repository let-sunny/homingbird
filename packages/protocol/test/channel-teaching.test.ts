import { describe, expect, it } from 'vitest'
import { CHANNEL_INSTRUCTION_MAX, CHANNEL_SOURCES_MAX } from '../src/channel-drafting.ts'
import {
  ChannelTeaching,
  TaughtFrom,
  channelInstructionMessage,
  channelInstructionProblem,
} from '../src/channel-teaching.ts'

describe('channelInstructionProblem', () => {
  it('accepts an instruction at the cap, counted without surrounding spaces, and distinct sources', () => {
    expect(
      channelInstructionProblem({
        instruction: ` ${'a'.repeat(CHANNEL_INSTRUCTION_MAX)} `,
        sources: ['https://wiki.example/a', 'https://wiki.example/b'],
      }),
    ).toBeNull()
    expect(channelInstructionProblem({ instruction: '', sources: [] })).toBeNull()
  })

  it('refuses an instruction over the cap', () => {
    expect(
      channelInstructionProblem({ instruction: 'a'.repeat(CHANNEL_INSTRUCTION_MAX + 1), sources: [] }),
    ).toBe('instruction_too_long')
  })

  it('refuses more sources than a channel may name', () => {
    const sources = Array.from(
      { length: CHANNEL_SOURCES_MAX + 1 },
      (_, index) => `https://wiki.example/${index}`,
    )
    expect(channelInstructionProblem({ instruction: '', sources })).toBe('too_many_sources')
    expect(channelInstructionProblem({ instruction: '', sources: sources.slice(1) })).toBeNull()
  })

  it('refuses a source named twice, ignoring case, scheme and a closing slash', () => {
    for (const second of ['https://wiki.example/a', 'http://WIKI.example/a/', 'https://wiki.example/a//'])
      expect(
        channelInstructionProblem({ instruction: '', sources: ['https://wiki.example/a', second] }),
      ).toBe('sources_repeated')
  })

  it('tells apart sources that differ only after their scheme', () => {
    expect(
      channelInstructionProblem({
        instruction: '',
        sources: ['https://wiki.example/a', 'https://wiki.example/https://wiki.example/a'],
      }),
    ).toBeNull()
    expect(
      channelInstructionProblem({
        instruction: '',
        sources: ['https://wiki.example/a', 'https://a.example/'],
      }),
    ).toBeNull()
  })
})

describe('channelInstructionMessage', () => {
  it('words every problem with its limit', () => {
    expect(channelInstructionMessage('instruction_too_long')).toBe(
      'A channel’s instruction may have at most 500 characters; link longer material as a source.',
    )
    expect(channelInstructionMessage('too_many_sources')).toBe('A channel may name at most 5 sources.')
    expect(channelInstructionMessage('sources_repeated')).toBe('Name each source once.')
  })
})

describe('ChannelTeaching', () => {
  it('decodes what a channel’s managers see, and nothing longer than the caps', () => {
    const teaching = {
      channel: 'billing',
      instruction: 'Be brief.',
      sources: ['https://wiki.example/a'],
      updatedAt: null,
      principles: [],
      limit: 50,
    }
    expect(ChannelTeaching.decode(teaching)._tag).toBe('Ok')
    expect(
      ChannelTeaching.decode({ ...teaching, instruction: 'a'.repeat(CHANNEL_INSTRUCTION_MAX + 1) })._tag,
    ).toBe('Err')
    expect(ChannelTeaching.decode({ ...teaching, sources: ['ftp://wiki.example/a'] })._tag).toBe('Err')
  })

  it('knows a principle taught from an edit or a discard, and nothing else', () => {
    expect(TaughtFrom.decode('edit')._tag).toBe('Ok')
    expect(TaughtFrom.decode('discard')._tag).toBe('Ok')
    expect(TaughtFrom.decode('manual')._tag).toBe('Err')
  })
})
