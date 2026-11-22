import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import type { Participants } from '../../src/models/participants.ts'
import { strings } from '../../src/strings.ts'
import { participantsCount, participantsList, participantsTitle } from '../../src/views/participants.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ANA, BEN } from '../support/fixtures.ts'

usingFakeDom()

const model: Participants = {
  id: 'people-room',
  label: '2 people',
  title: strings.participants.title,
  summary: 'Ana and Ben',
  people: [
    { memberId: ANA, name: 'Ana', you: true, roles: [] },
    { memberId: BEN, name: 'Ben', you: false, roles: ['Asked this question', 'Manages #billing'] },
  ],
  note: null,
}

describe('participantsList', () => {
  it('is a menu named for its title, with each person and each of their parts', () => {
    const list = participantsList(model)
    document.body.append(list)
    expect(list.id).toBe('people-room')
    expect(list.getAttribute('aria-label')).toBe(strings.participants.title)
    const rows = [...list.querySelectorAll('li')]
    expect(rows.map((row) => row.getAttribute('data-member'))).toEqual([ANA, BEN])
    expect(rows[0]!.querySelector('.participant-roles')).toBeNull()
    expect(
      [...rows[1]!.querySelectorAll('.participant-roles small')].map((role) => role.textContent),
    ).toEqual(['Asked this question', 'Manages #billing'])
    expect(textOf(rows[0]!)).toBe(`Ana ${strings.youMark}`)
    expect(list.querySelector('.people-later')).toBeNull()
    expect(textOf(participantsList({ ...model, note: 'Later managers read it.' }))).toContain(
      'Later managers read it.',
    )
  })
})

describe('participantsCount and participantsTitle', () => {
  it('both open the list, and name everyone on hover', () => {
    const host = document.createElement('div')
    host.append(participantsCount(model), participantsTitle(model, 'Ben'))
    for (const name of ['2 people', 'Ben']) {
      const opener = getByRole(host, 'button', { name })
      expect(opener.getAttribute('popovertarget')).toBe('people-room')
      expect(opener.getAttribute('title')).toBe('Ana and Ben')
    }
  })
})
