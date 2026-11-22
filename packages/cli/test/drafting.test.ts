import { AUTO_SENT_NOTICE, Forbidden } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/failure.ts'
import { DRAFT, QUESTION, READING } from './command-fixtures.ts'
import { AGENT_TOKEN, BEN, CONVERSATION_ID, type Stubs, world } from './support.ts'

describe('draft', () => {
  const drafting = (stubs: Stubs = {}, variables: Readonly<Record<string, string>> = {}) => {
    const bodies: unknown[] = []
    const w = world({
      variables,
      stubs: {
        ...READING,
        'drafts.create': (request) => {
          bodies.push(request.body)
          return DRAFT
        },
        ...stubs,
      },
    })
    return { w, bodies }
  }

  it('drafts to a colleague by email with the agent credential, and says nothing was sent', async () => {
    const { w, bodies } = drafting()
    expect(await w.run('draft', '--to', 'Ben@Example.com', 'Is', 'it', 'safe?')).toBe(0)
    expect(bodies).toEqual([{ body: 'Is it safe?', to: [BEN.id], client: 'homingbird' }])
    expect(w.lines).toEqual([
      `Draft ${DRAFT.id} is waiting for a person to approve it. It has not been sent.`,
    ])
    expect(w.calls.every((call) => call.authorization === `Bearer ${AGENT_TOKEN}`)).toBe(true)
    expect(w.calls.map((call) => call.route)).toEqual(['directory.list', 'drafts.create'])
  })

  it('says a draft was sent when it matched a saved answer its person switched to send automatically', async () => {
    const { w } = drafting({
      'drafts.create': () => ({ ...DRAFT, status: 'sent', sentAt: 1, autoSent: true }),
    })
    expect(await w.run('draft', '--to', BEN.id, 'Nine to five.')).toBe(0)
    expect(w.lines).toEqual([`Note ${DRAFT.id} was sent. ${AUTO_SENT_NOTICE}`])
  })

  it('drafts to a member id without looking anyone up', async () => {
    const { w, bodies } = drafting()
    await w.run('draft', '--to', BEN.id, 'hello')
    expect(bodies).toEqual([{ body: 'hello', to: [BEN.id], client: 'homingbird' }])
    expect(w.calls.map((call) => call.route)).toEqual(['drafts.create'])
  })

  it('drafts a reply and drafts into a conversation', async () => {
    const { w, bodies } = drafting()
    await w.run('draft', '--reply', QUESTION.id, 'Yes.')
    await w.run('draft', '--conversation', CONVERSATION_ID, 'Hello', '--json')
    expect(bodies).toEqual([
      { body: 'Yes.', inReplyTo: QUESTION.id, client: 'homingbird' },
      { body: 'Hello', conversationId: CONVERSATION_ID, client: 'homingbird' },
    ])
    expect(w.json().draft).toMatchObject({ id: DRAFT.id, status: 'draft', body: 'Yes, after six.' })
  })

  it('passes what the draft relied on, for the person only', async () => {
    const { w, bodies } = drafting()
    await w.run('draft', '--reply', QUESTION.id, '--basis', 'Read the runbook', 'Yes.')
    expect(bodies).toEqual([
      { body: 'Yes.', inReplyTo: QUESTION.id, basis: 'Read the runbook', client: 'homingbird' },
    ])
  })

  it('labels the draft with the program an integration names, and a stated model, made printable', async () => {
    const { w, bodies } = drafting({}, { HOMINGBIRD_CLIENT: '\u202eClaude Code 2.1.327' })
    await w.run('draft', '--reply', QUESTION.id, '--model', 'claude-opus-5-5\u0007', 'Yes.')
    await w.run('draft', '--reply', QUESTION.id, '--model', '\u200b', 'Again.')
    expect(bodies).toEqual([
      { body: 'Yes.', inReplyTo: QUESTION.id, client: 'Claude Code 2.1.327', model: 'claude-opus-5-5' },
      { body: 'Again.', inReplyTo: QUESTION.id, client: 'Claude Code 2.1.327' },
    ])
  })

  it('gives a note back without a draft, with or without a reason', async () => {
    const released: unknown[] = []
    const w = world({
      stubs: {
        ...READING,
        'notes.release': (request) => {
          released.push(request)
          return QUESTION
        },
      },
    })
    expect(await w.run('skip', QUESTION.id, 'Not', 'my', 'area.')).toBe(0)
    await w.run('skip', QUESTION.id)
    expect(released).toMatchObject([
      { params: { id: QUESTION.id }, body: { reason: 'Not my area.' } },
      { params: { id: QUESTION.id }, body: {} },
    ])
    expect(w.lines[0]).toBe(
      `Gave ${QUESTION.id} back without a draft; colleagues no longer see "drafting reply". Your person sees the reason.`,
    )
    expect(w.calls.every((call) => call.authorization === `Bearer ${AGENT_TOKEN}`)).toBe(true)
    expect(await w.run('skip', 'nope')).toBe(EXIT.failed)
    expect(w.problems).toEqual(['That is not a note id.'])
  })

  it.each([
    [['--to', 'nobody@example.com'], 'Nobody on this server has the address nobody@example.com.'],
    [['--reply', 'nope'], 'That is not a draft id.'],
    [['--conversation', 'nope'], 'That is not a conversation id.'],
  ])('refuses %j before drafting anything', async (target, message) => {
    const { w, bodies } = drafting()
    expect(await w.run('draft', ...target, 'text')).toBe(EXIT.failed)
    expect(w.problems).toEqual([message])
    expect(bodies).toEqual([])
  })

  it('reports what the server refuses', async () => {
    const { w } = drafting({ 'drafts.create': () => Forbidden({ message: 'You cannot message Ben.' }) })
    expect(await w.run('draft', '--to', BEN.id, 'hi')).toBe(EXIT.failed)
    expect(w.problems).toEqual(['You cannot message Ben.'])
  })
})

describe('drafts and pickup', () => {
  it('lists waiting drafts, or says there are none', async () => {
    const w = world({ stubs: READING })
    await w.run('drafts')
    expect(w.lines[0]).toBe(`[${DRAFT.id}] you, draft, replying to ${QUESTION.id}:\nYes, after six.`)
    const none = world({ stubs: { 'drafts.list': () => ({ drafts: [] }) } })
    await none.run('drafts')
    expect(none.lines).toEqual(['No drafts are waiting for approval.'])
    await none.run('drafts', '--json')
    expect(none.json()).toEqual({ drafts: [] })
  })

  it('picks up a note so colleagues see a reply is being drafted', async () => {
    const w = world({ stubs: { 'notes.pickup': () => QUESTION } })
    await w.run('pickup', QUESTION.id)
    expect(w.lines).toEqual([`Picked up ${QUESTION.id}; colleagues now see "drafting reply".`])
    expect(w.calls[0]).toMatchObject({ method: 'POST', path: `/api/v1/notes/${QUESTION.id}/pickup` })
    const bad = world()
    expect(await bad.run('pickup', 'nope')).toBe(EXIT.failed)
    expect(bad.calls).toEqual([])
  })
})
