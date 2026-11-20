import { describe, expect, it } from 'vitest'
import { type DebateAuthorInput, debateAuthorModel } from '../../src/models/debate-author.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, everything, member, serverInfo } from '../support/fixtures.ts'

const input = (fields: Partial<DebateAuthorInput> = {}): DebateAuthorInput => ({
  viewerId: ANA,
  members: new Map([
    [ANA, member(ANA, 'Ana')],
    [BEN, member(BEN, 'Ben')],
  ]),
  serverInfo: everything(),
  ...fields,
})

describe('debateAuthorModel', () => {
  it('shows a colleague’s agent with the model it stated and its connection, as a note’s author', () => {
    const line = strings.authorship.agent({ name: 'Ben' })
    expect(
      debateAuthorModel(input(), { id: 'd-turn-2', memberId: BEN, agentName: 'Desk', agentModel: 'gpt-6' }),
    ).toEqual({
      id: 'author-d-turn-2',
      buttonClass: 'author-button is-agent',
      buttonLabel: strings.debates.authorWho({ authorship: line }),
      avatar: expect.objectContaining({ label: null }),
      agentMark: true,
      line,
      debate: null,
      details: [
        { text: strings.authorship.model({ model: 'gpt-6' }), className: null },
        { text: strings.authorship.connection({ name: 'Desk' }), className: null },
        { text: strings.debates.modelReported, className: 'author-reported' },
      ],
      sent: null,
    })
  })

  it('says a model was not stated, names no connection it does not know, and calls the viewer’s agent theirs', () => {
    const mine = debateAuthorModel(input(), { id: 'x', memberId: ANA, agentName: null })
    expect(mine.line).toBe(strings.authorship.agentYou)
    expect(mine.details).toEqual([
      { text: strings.authorship.modelNotStated, className: null },
      { text: strings.debates.modelReported, className: 'author-reported' },
    ])
    expect(
      debateAuthorModel(input(), { id: 'x', memberId: BEN, agentName: 'Desk', agentModel: null }).details[0],
    ).toEqual({ text: strings.authorship.modelNotStated, className: null })
    expect(debateAuthorModel(input(), { id: 'x', memberId: CY, agentName: 'Desk' }).line).toBe(
      strings.authorship.agent({ name: strings.formerMember }),
    )
  })

  it('shows no details while the organization keeps note details off', () => {
    const off = input({ serverInfo: serverInfo({ debateRooms: true, characters: true, noteDetails: false }) })
    expect(
      debateAuthorModel(off, { id: 'x', memberId: BEN, agentName: 'Desk', agentModel: 'gpt-6' }).details,
    ).toEqual([])
  })
})
