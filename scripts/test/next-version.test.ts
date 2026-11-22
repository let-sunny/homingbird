import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ConventionalCommit } from '../conventional-commit.ts'
import { bumpFor, nextVersion, parseVersion } from '../next-version.ts'

const TYPES = ['feat', 'fix', 'perf', 'chore', 'docs', 'test', 'ci', 'build', 'refactor'] as const
const QUIET = ['chore', 'docs', 'test', 'ci', 'build', 'refactor'] as const

const commitOf = (type: string, breaking = false): ConventionalCommit => ({
  type,
  scope: null,
  breaking,
  summary: 'x',
  firstParagraph: '',
  breakingNote: '',
})

const commits = fc.array(
  fc
    .record({ type: fc.constantFrom(...TYPES), breaking: fc.boolean() })
    .map(({ type, breaking }) => commitOf(type, breaking)),
  { maxLength: 12 },
)
const stable = fc
  .tuple(fc.nat(5), fc.nat(20), fc.nat(20))
  .map(([major, minor, patch]) => ({ major, minor, patch }))

describe('the next version', () => {
  it('bumps the minor for a breaking change and the patch for anything else for users, before 1.0, without a schema step', () => {
    fc.assert(
      fc.property(fc.nat(20), fc.nat(20), commits, (minor, patch, list) => {
        const next = nextVersion(`0.${minor}.${patch}`, list, null, false)
        if (list.some((commit) => commit.breaking)) expect(next).toBe(`0.${minor + 1}.0`)
        else if (list.some((commit) => ['feat', 'fix', 'perf'].includes(commit.type)))
          expect(next).toBe(`0.${minor}.${patch + 1}`)
        else expect(next).toBeNull()
      }),
    )
  })

  it('bumps major, minor or patch from 1.0 on', () => {
    fc.assert(
      fc.property(stable, commits, fc.boolean(), ({ major, minor, patch }, list, schemaStep) => {
        const current = `${major + 1}.${minor}.${patch}`
        const next = nextVersion(current, list, null, schemaStep)
        if (list.some((commit) => commit.breaking)) expect(next).toBe(`${major + 2}.0.0`)
        else if (list.some((commit) => commit.type === 'feat'))
          expect(next).toBe(`${major + 1}.${minor + 1}.0`)
        else if (list.some((commit) => commit.type === 'fix' || commit.type === 'perf'))
          expect(next).toBe(`${major + 1}.${minor}.${patch + 1}`)
        else expect(next).toBeNull()
      }),
    )
  })

  it('releases nothing for commits only for contributors, however many', () => {
    fc.assert(
      fc.property(
        stable,
        fc.array(fc.constantFrom(...QUIET), { maxLength: 20 }),
        fc.boolean(),
        (version, types, schemaStep) => {
          const current = `${version.major}.${version.minor}.${version.patch}`
          expect(
            nextVersion(
              current,
              types.map((type) => commitOf(type)),
              null,
              schemaStep,
            ),
          ).toBeNull()
          expect(
            bumpFor(
              types.map((type) => commitOf(type)),
              version.major,
              schemaStep,
            ),
          ).toBeNull()
        },
      ),
    )
  })

  it('always moves forward when it releases', () => {
    fc.assert(
      fc.property(
        stable,
        commits,
        fc.constantFrom(null, 'rc', 'beta'),
        fc.boolean(),
        (version, list, pre, schemaStep) => {
          const current = `${version.major}.${version.minor}.${version.patch}`
          const next = nextVersion(current, list, pre, schemaStep)
          if (next === null) return
          const [a, b] = [parseVersion(current), parseVersion(next)]
          expect(compare(b, a)).toBeGreaterThan(0)
        },
      ),
    )
  })

  it('starts, continues, switches and finishes a pre-release', () => {
    const fix = [commitOf('fix')]
    expect(nextVersion('0.1.0', fix, 'rc', false)).toBe('0.1.1-rc.1')
    expect(nextVersion('0.1.0', [commitOf('feat', true)], 'rc', false)).toBe('0.2.0-rc.1')
    expect(nextVersion('0.1.0', [commitOf('docs')], 'rc', false)).toBeNull()
    expect(nextVersion('0.2.0-rc.1', fix, 'rc', false)).toBe('0.2.0-rc.2')
    expect(nextVersion('0.2.0-rc.1', [commitOf('docs')], 'rc', false)).toBeNull()
    expect(nextVersion('0.2.0-rc.3', [commitOf('docs')], 'beta', false)).toBe('0.2.0-beta.1')
    expect(nextVersion('v0.2.0-rc.3', [commitOf('chore')], null, false)).toBe('0.2.0')
  })

  it('bumps at least the minor for a new schema step before 1.0', () => {
    fc.assert(
      fc.property(fc.nat(20), fc.nat(20), commits, (minor, patch, list) => {
        const bump = bumpFor(list, 0, true)
        if (bump !== null) expect(bump).toBe('minor')
        const next = nextVersion(`0.${minor}.${patch}`, list, null, true)
        if (next !== null) expect(next).toBe(`0.${minor + 1}.0`)
      }),
    )
  })

  it('bumps the patch for features and fixes without a schema step or a breaking change before 1.0', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...TYPES), { minLength: 1, maxLength: 12 }), (types) => {
        const list = [commitOf('fix'), ...types.map((type) => commitOf(type))]
        expect(bumpFor(list, 0, false)).toBe('patch')
      }),
    )
  })

  it('releases nothing for a schema step that comes only with commits for contributors', () => {
    expect(bumpFor([commitOf('refactor')], 0, true)).toBeNull()
    expect(nextVersion('0.3.8', [commitOf('chore')], null, true)).toBeNull()
  })

  it('keeps the usual rules from 1.0 on, whether or not a schema step is new', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), commits, (major, list) => {
        expect(bumpFor(list, major, true)).toBe(bumpFor(list, major, false))
      }),
    )
  })

  it('starts a pre-release of the next minor for a schema step', () => {
    expect(nextVersion('0.3.8', [commitOf('fix')], 'rc', true)).toBe('0.4.0-rc.1')
    expect(nextVersion('0.3.8', [commitOf('feat')], null, true)).toBe('0.4.0')
  })

  it('refuses something that is not a version', () => {
    expect(() => parseVersion('1.2')).toThrow('1.2 is not a version')
    expect(() => parseVersion('1.2.3-RC1')).toThrow()
  })
})

const compare = (a: ReturnType<typeof parseVersion>, b: ReturnType<typeof parseVersion>): number =>
  a.major - b.major ||
  a.minor - b.minor ||
  a.patch - b.patch ||
  (a.pre === null ? 1 : 0) - (b.pre === null ? 1 : 0) ||
  (a.pre?.number ?? 0) - (b.pre?.number ?? 0)
