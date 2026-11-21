import { describe, expect, it } from 'vitest'
import { emailToBind, invitesModel, showsInvites } from '../../src/models/invites.ts'
import { formats, strings } from '../../src/strings.ts'
import { ANA, everything, me, serverInfo } from '../support/fixtures.ts'

const invite = (id: string, createdAt: number, email: string | null = null) => ({
  id,
  email,
  createdBy: ANA,
  createdAt,
  expiresAt: createdAt + 7 * 86_400_000,
})

const link = (email: string | null) => ({
  invite: invite('inv_new', 0, email),
  url: 'https://hb.example.com/#/invite/hbi_secret',
})

describe('invitesModel', () => {
  it('offers to make a link, then says while it is being made', () => {
    const idle = invitesModel({ making: { kind: 'idle' }, pending: null, now: 0 })
    expect(idle).toMatchObject({
      title: strings.invites.title,
      intro: strings.invites.intro,
      email: { label: strings.invites.email, hint: strings.invites.emailHint },
      create: strings.invites.create,
      busy: false,
      problem: null,
      made: null,
      pending: null,
    })
    const creating = invitesModel({ making: { kind: 'creating' }, pending: null, now: 0 })
    expect([creating.create, creating.busy]).toEqual([strings.invites.creating, true])
    expect(invitesModel({ making: { kind: 'failed' }, pending: null, now: 0 }).problem).toBe(
      strings.invites.failed,
    )
  })

  it('shows the link just made once, for anyone or for the address it is bound to, and how copying went', () => {
    const anyone = invitesModel({
      making: { kind: 'made', link: link(null), copied: 'not yet' },
      pending: [],
      now: 0,
    })
    expect(anyone.made).toEqual({
      url: 'https://hb.example.com/#/invite/hbi_secret',
      explanation: strings.invites.made,
      copy: strings.invites.copy,
      copyProblem: null,
    })
    const bound = invitesModel({
      making: { kind: 'made', link: link('friend@gmail.com'), copied: 'copied' },
      pending: [],
      now: 0,
    })
    expect(bound.made).toMatchObject({
      explanation: strings.invites.madeFor({ email: 'friend@gmail.com' }),
      copy: strings.invites.copied,
    })
    const refused = invitesModel({
      making: { kind: 'made', link: link(null), copied: 'refused' },
      pending: [],
      now: 0,
    })
    expect(refused.made?.copyProblem).toBe(strings.invites.copyFailed)
  })

  it('lists waiting invites newest first, leaving out those that expired on this clock', () => {
    const model = invitesModel({
      making: { kind: 'idle' },
      pending: [
        invite('older', 1_000, 'friend@gmail.com'),
        invite('newer', 2_000),
        invite('gone', -8 * 86_400_000),
      ],
      now: 5_000,
    })
    expect(model.pending).toEqual([
      {
        id: 'newer',
        who: strings.invites.anyone,
        expires: strings.invites.expires({ date: formats.full.format(new Date(2_000 + 7 * 86_400_000)) }),
        revoke: strings.invites.revoke,
      },
      expect.objectContaining({ id: 'older', who: 'friend@gmail.com' }),
    ])
    expect(invitesModel({ making: { kind: 'idle' }, pending: [], now: 0 }).none).toBe(strings.invites.none)
  })
})

describe('showsInvites', () => {
  it('puts invites in Administration for an administrator and on People for a member allowed to invite', () => {
    const admin = me({ canInvite: true }, { role: 'admin' })
    const member = me({ canInvite: true })
    expect([showsInvites('admin', admin, everything()), showsInvites('people', admin, everything())]).toEqual(
      [true, false],
    )
    expect([
      showsInvites('admin', member, everything()),
      showsInvites('people', member, everything()),
    ]).toEqual([false, true])
  })

  it('shows nothing to someone who may not invite, or where the server has invites off', () => {
    expect(showsInvites('people', me({ canInvite: false }), everything())).toBe(false)
    expect(showsInvites('people', me(), everything())).toBe(false)
    expect(
      showsInvites('admin', me({ canInvite: true }, { role: 'admin' }), serverInfo({ invites: false })),
    ).toBe(false)
  })
})

describe('emailToBind', () => {
  it.each([
    ['', null],
    ['   ', null],
    [' Friend@Gmail.com ', 'friend@gmail.com'],
  ])('reads %j as %j', (typed, expected) => {
    expect(emailToBind(typed)).toBe(expected)
  })
})
