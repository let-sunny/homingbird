import type { MemberId } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { emailsFromCsv, importPreview } from '../src/group-import.ts'
import { ANA, BEN, CY, member } from './support/fixtures.ts'

const address = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,11}$/),
    fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,9}$/),
    fc.constantFrom('com', 'io', 'kr'),
  )
  .map(([local, domain, top]) => `${local}@${domain}.${top}`)

const anyCase = (text: string, upper: ReadonlyArray<boolean>): string =>
  [...text]
    .map((character, index) => (upper[index % upper.length] ? character.toUpperCase() : character))
    .join('')

const quoted = (value: string): string => `"${value.replaceAll('"', '""')}"`

const unique = (emails: ReadonlyArray<string>): string[] => [...new Set(emails)]

describe('emailsFromCsv', () => {
  it('reads one address per line, in lower case, each once, in the order of the file', () => {
    fc.assert(
      fc.property(
        fc.array(address, { maxLength: 20 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
        fc.constantFrom('\n', '\r\n', '\r'),
        (emails, upper, newline) => {
          const file = emails.map((email) => `  ${anyCase(email, upper)} `).join(newline)
          expect(emailsFromCsv(file)).toEqual(unique(emails))
        },
      ),
    )
  })

  it('reads the column named email wherever it is, whatever the other columns hold', () => {
    const other = fc.string({ maxLength: 12 }).filter((text) => !/[\r\n]/.test(text))
    fc.assert(
      fc.property(
        fc.array(fc.tuple(address, other, other), { maxLength: 15 }),
        fc.nat({ max: 2 }),
        fc.constantFrom('email', 'Email', ' EMAIL '),
        (rows, column, header) => {
          const cellsOf = (email: string, first: string, second: string): string[] => {
            const others = [quoted(first), quoted(second)]
            return [...others.slice(0, column), email, ...others.slice(column)]
          }
          const file = [
            cellsOf(header, 'name', 'team').join(','),
            ...rows.map(([email, first, second]) => cellsOf(email, first, second).join(',')),
          ].join('\n')
          expect(emailsFromCsv(file)).toEqual(unique(rows.map(([email]) => email)))
        },
      ),
    )
  })

  it('skips blank lines, a byte order mark, and a row too short for the column', () => {
    expect(emailsFromCsv('﻿name,email\n\nAna,ana@example.com\nBen\n')).toEqual(['ana@example.com'])
    expect(emailsFromCsv('"ana@example.com",Ana\n')).toEqual(['ana@example.com'])
    expect(emailsFromCsv('')).toEqual([])
  })
})

describe('importPreview', () => {
  const people = [member(ANA, 'Ana'), member(BEN, 'Ben'), member(CY, 'Cy', { status: 'deactivated' })]

  it('makes the group exactly the active people the file names, and lists who changes', () => {
    expect(
      importPreview(['ben@example.com', 'BEN@example.com', 'cy@example.com', 'nobody@example.com'], people, [
        ANA,
      ]),
    ).toEqual({
      memberIds: [BEN],
      added: [BEN],
      removed: [ANA],
      unknown: ['cy@example.com', 'nobody@example.com'],
    })
  })

  it('round-trips: applying what it adds and removes to the members gives the file’s members', () => {
    const ids = fc.constantFrom(ANA, BEN, CY)
    fc.assert(
      fc.property(
        fc.uniqueArray(ids),
        fc.array(fc.constantFrom('ana@example.com', 'ben@example.com', 'cy@example.com', 'x@example.com')),
        (current, emails) => {
          const preview = importPreview(emails, people, current)
          const after = new Set<MemberId>(current)
          for (const id of preview.removed) after.delete(id)
          for (const id of preview.added) after.add(id)
          expect([...after].sort()).toEqual([...preview.memberIds].sort())
          const active = ['ana@example.com', 'ben@example.com']
          expect(preview.unknown).toEqual(emails.filter((email) => !active.includes(email)))
          expect(preview.memberIds).not.toContain(CY)
        },
      ),
    )
  })
})
