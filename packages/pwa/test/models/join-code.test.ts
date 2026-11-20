import { describe, expect, it } from 'vitest'
import { joinCodeModel, joinCommand } from '../../src/models/join-code.ts'
import { strings } from '../../src/strings.ts'

const NOW = 1_000_000
const code = { code: 'hbj_secret', serverUrl: 'https://hb.example.com', expiresAt: NOW + 600_000 }
const made = { kind: 'made' as const, code, copied: 'not yet' as const }

describe('joinCodeModel', () => {
  it('offers to make a code for the person’s own agent, or for a channel’s', () => {
    expect(joinCodeModel({ state: { kind: 'idle' }, now: NOW, agent: null })).toEqual({
      kind: 'offer',
      title: strings.joinCode.title,
      intro: strings.joinCode.intro,
      button: strings.joinCode.create,
      busy: false,
      problem: null,
    })
    expect(joinCodeModel({ state: { kind: 'idle' }, now: NOW, agent: 'Payments wiki' })).toMatchObject({
      intro: strings.joinCode.introAgent({ agent: 'Payments wiki' }),
    })
  })

  it('says while a code is being made, and when none could be', () => {
    expect(joinCodeModel({ state: { kind: 'creating' }, now: NOW, agent: null })).toMatchObject({
      button: strings.joinCode.creating,
      busy: true,
    })
    expect(joinCodeModel({ state: { kind: 'failed' }, now: NOW, agent: null })).toMatchObject({
      button: strings.joinCode.create,
      busy: false,
      problem: strings.joinCode.failed,
    })
  })

  it('shows the whole line to paste and how long it still works, to the second', () => {
    expect(joinCodeModel({ state: made, now: NOW, agent: null })).toEqual({
      kind: 'code',
      title: strings.joinCode.title,
      command: 'homingbird setup --server https://hb.example.com --join hbj_secret --agent claude',
      explanation: strings.joinCode.explanation,
      countdown: strings.joinCode.expiresIn({ time: '10:00' }),
      copy: strings.joinCode.copy,
      copyProblem: null,
    })
    expect(joinCodeModel({ state: made, now: NOW + 599_001, agent: 'Wiki' })).toMatchObject({
      explanation: strings.joinCode.explanationAgent({ agent: 'Wiki' }),
      countdown: strings.joinCode.expiresIn({ time: '0:01' }),
    })
    expect(joinCodeModel({ state: made, now: NOW + 125_000, agent: null })).toMatchObject({
      countdown: strings.joinCode.expiresIn({ time: '7:55' }),
    })
  })

  it('says it was copied, or that the browser would not copy it', () => {
    expect(joinCodeModel({ state: { ...made, copied: 'copied' }, now: NOW, agent: null })).toMatchObject({
      copy: strings.joinCode.copied,
      copyProblem: null,
    })
    expect(joinCodeModel({ state: { ...made, copied: 'refused' }, now: NOW, agent: null })).toMatchObject({
      copy: strings.joinCode.copy,
      copyProblem: strings.joinCode.copyFailed,
    })
  })

  it('offers a new code once the shown one expired', () => {
    expect(joinCodeModel({ state: made, now: NOW + 600_000, agent: null })).toEqual({
      kind: 'expired',
      title: strings.joinCode.title,
      text: strings.joinCode.expired,
      button: strings.joinCode.again,
    })
  })

  it('builds the line from the address the server gave', () => {
    expect(joinCommand({ ...code, serverUrl: 'https://relay.example/hb' })).toBe(
      'homingbird setup --server https://relay.example/hb --join hbj_secret --agent claude',
    )
  })
})
