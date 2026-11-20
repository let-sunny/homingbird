import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  preReleaseOf,
  releaseNotes,
  releasePlan,
  releasesWithoutUpgradeFixture,
  schemaStepsIn,
  syncedFiles,
  versionPullRequest,
  versionsIn,
  withRelease,
  withUpgradeFixture,
} from '../release-version.ts'

const root = join(import.meta.dirname, '..', '..')
const read = (file: string): string => readFileSync(join(root, file), 'utf8')

describe('the oldest Claude Code the plugin supports', () => {
  it('is the same in the plugin, its manifest and its README', () => {
    const declared = /MINIMUM_HOST_VERSION = '([^']+)'/.exec(
      read('packages/plugin/hooks/host-support.ts'),
    )?.[1]
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/)
    expect(JSON.parse(read('packages/plugin/.claude-plugin/plugin.json')).engines['claude-code']).toBe(
      `>=${declared}`,
    )
    expect(read('packages/plugin/README.md')).toContain(`Claude Code ${declared} or newer`)
    expect(read('packages/plugin/hooks/pane-text/en.ts')).toContain(`Claude Code to ${declared} or newer`)
  })
})

describe('the version of every package', () => {
  it('is the same in every workspace package, the root, the plugin manifest, the marketplace entry and every version constant', () => {
    const packages = readdirSync(join(root, 'packages')).filter((name) => {
      try {
        return read(`packages/${name}/package.json`) !== ''
      } catch {
        return false
      }
    })
    const versions = versionsIn(read, packages)
    expect(versions.size).toBe(packages.length + 6)
    expect(new Set(versions.values()).size).toBe(1)
  })

  it('is set in every package, the root, the plugin manifest, the marketplace entry and every version constant by one sync', () => {
    const marketplace = (version: string) =>
      `{\n  "name": "homingbird",\n  "plugins": [\n    {\n      "name": "homingbird",\n      "source": { "source": "npm", "package": "@homingbird/mod", "version": "${version}" }\n    }\n  ]\n}\n`
    const files: Record<string, string> = {
      'packages/cli/package.json': '{\n  "name": "@homingbird/cli",\n  "version": "0.1.0-rc.2"\n}\n',
      'package.json': '{\n  "name": "homingbird",\n  "version": "0.1.0-rc.2",\n  "private": true\n}\n',
      'packages/plugin/.claude-plugin/plugin.json':
        '{\n  "name": "homingbird",\n  "version": "0.1.0-rc.2"\n}\n',
      '.claude-plugin/marketplace.json': marketplace('0.1.0-rc.2'),
      'packages/cli/src/version.ts': "export const CLI_VERSION = '0.1.0-rc.2'\n",
      'packages/mcp/src/version.ts': "export const ADAPTER_VERSION = '0.1.0-rc.2'\n",
      'packages/dovecote/src/version.ts': "export const SERVER_VERSION = '0.1.0-rc.2'\n",
    }
    const synced = syncedFiles('0.1.0', (file) => files[file]!, ['cli'])
    expect(Object.fromEntries(synced.map(({ file, text }) => [file, text]))).toEqual({
      'packages/cli/package.json': '{\n  "name": "@homingbird/cli",\n  "version": "0.1.0"\n}\n',
      'package.json': '{\n  "name": "homingbird",\n  "version": "0.1.0",\n  "private": true\n}\n',
      'packages/plugin/.claude-plugin/plugin.json': '{\n  "name": "homingbird",\n  "version": "0.1.0"\n}\n',
      '.claude-plugin/marketplace.json': marketplace('0.1.0'),
      'packages/cli/src/version.ts': "export const CLI_VERSION = '0.1.0'\n",
      'packages/mcp/src/version.ts': "export const ADAPTER_VERSION = '0.1.0'\n",
      'packages/dovecote/src/version.ts': "export const SERVER_VERSION = '0.1.0'\n",
    })
  })

  it('refuses to sync a file that holds no version', () => {
    expect(() => syncedFiles('0.1.0', () => '{}')).toThrow('package.json has no version to set.')
  })
})

describe('deciding whether to publish', () => {
  it('publishes a plain version as latest and a pre-release as next', () => {
    expect(releasePlan({ version: '0.1.0', tagExists: false, published: false })).toEqual({
      version: '0.1.0',
      tag: 'v0.1.0',
      prerelease: false,
      distTag: 'latest',
      release: true,
    })
    expect(releasePlan({ version: '0.1.0-rc.3', tagExists: false, published: false })).toMatchObject({
      tag: 'v0.1.0-rc.3',
      prerelease: true,
      distTag: 'next',
      release: true,
    })
  })

  it('does nothing for a version that is tagged and on npm, and finishes one that is only half done', () => {
    expect(releasePlan({ version: '0.1.0', tagExists: true, published: true }).release).toBe(false)
    expect(releasePlan({ version: '0.1.0', tagExists: false, published: true }).release).toBe(true)
    expect(releasePlan({ version: '0.1.0', tagExists: true, published: false }).release).toBe(true)
  })
})

describe('the root changelog', () => {
  const HEAD = '# Changelog\n\nEvery release, newest first.\n\n'

  it('turns the Unreleased section into the release, keeping what it says and adding the notes', () => {
    const before = `${HEAD}## [Unreleased]\n\nThe first release.\n\n### Known limits\n\n- One process.\n\n[Unreleased]: https://example.com\n`
    expect(withRelease(before, '0.1.0', '2026-11-20', '### Fixed\n\n- keep the cursor')).toBe(
      `${HEAD}## [0.1.0] - 2026-11-20\n\nThe first release.\n\n### Known limits\n\n- One process.\n\n### Fixed\n\n- keep the cursor\n\n[0.1.0]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0\n`,
    )
  })

  it('adds a new release above the earlier ones, with its link above theirs', () => {
    const before = `${HEAD}## [0.1.0] - 2026-11-20\n\nFirst.\n\n[0.1.0]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0\n`
    const after = withRelease(before, '0.1.1', '2026-12-01', '### Fixed\n\n- sign in again')
    expect(after).toBe(
      `${HEAD}## [0.1.1] - 2026-12-01\n\n### Fixed\n\n- sign in again\n\n## [0.1.0] - 2026-11-20\n\nFirst.\n\n[0.1.1]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.1\n[0.1.0]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0\n`,
    )
  })

  it('handles a changelog with no release and no links yet, and a release with no notes', () => {
    expect(withRelease(HEAD, '0.1.0', '2026-11-20', '')).toBe(
      `${HEAD.trimEnd()}\n\n## [0.1.0] - 2026-11-20\n\n[0.1.0]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0\n`,
    )
    expect(withRelease(`${HEAD}## [Unreleased]\n\nNotes.`, '0.2.0', '2027-01-01', '')).toContain(
      '## [0.2.0] - 2027-01-01\n\nNotes.',
    )
  })

  it('gives a release its section as notes, and nothing for a version it does not have', () => {
    const changelog = `${HEAD}## [0.1.1] - 2026-12-01\n\n- Fixed sign-in.\n\n## [0.1.0] - 2026-11-20\n\nFirst.\n\n[0.1.0]: https://x\n`
    expect(releaseNotes(changelog, '0.1.1')).toBe('- Fixed sign-in.')
    expect(releaseNotes(changelog, '0.1.0')).toBe('First.')
    expect(releaseNotes(changelog, '9.9.9')).toBe('')
    expect(releaseNotes(`${HEAD}## [0.3.0] - 2027-01-01\n\nLast.`, '0.3.0')).toBe('Last.')
  })

  it('puts the first pre-release above the link references', () => {
    const before = `${HEAD}## [Unreleased]\n\nNotes.\n\n[0.0.9]: https://x\n`
    expect(withRelease(before, '0.1.0-rc.1', '2026-11-20', '### Added\n\n- one')).toBe(
      `${HEAD}## [Unreleased]\n\nNotes.\n\n## [0.1.0-rc.1] - 2026-11-20\n\n### Added\n\n- one\n\n[0.1.0-rc.1]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0-rc.1\n[0.0.9]: https://x\n`,
    )
  })

  it('puts a pre-release below the Unreleased section, which waits for the final version', () => {
    const before = `${HEAD}## [Unreleased]\n\nThe first release.\n\n## [0.1.0-rc.2] - 2026-11-10\n\nOld.\n`
    const after = withRelease(before, '0.1.0-rc.3', '2026-11-20', '### Added\n\n- skip with a reason')
    expect(after).toContain(
      '## [Unreleased]\n\nThe first release.\n\n## [0.1.0-rc.3] - 2026-11-20\n\n### Added\n\n- skip with a reason\n\n## [0.1.0-rc.2]',
    )
    expect(releaseNotes(after, '0.1.0-rc.3')).toBe('### Added\n\n- skip with a reason')
  })
})

describe('the Version Packages pull request', () => {
  it('names the version, says what merging does, and carries the changelog section', () => {
    const { title, body } = versionPullRequest('0.1.0', null, '### Added\n\n- skip with a reason')
    expect(title).toBe('Version Packages')
    expect(body).toContain('Merging this pull request releases **0.1.0**')
    expect(body).toContain('tags v0.1.0')
    expect(body).toContain('Edit the section in `CHANGELOG.md` on this branch')
    expect(body.endsWith('## 0.1.0\n\n### Added\n\n- skip with a reason')).toBe(true)
    expect(body).not.toContain('pre-release')
  })

  it('marks a pre-release in the title and says how to release the final version', () => {
    const { title, body } = versionPullRequest('0.1.0-rc.3', 'rc', '')
    expect(title).toBe('Version Packages (rc)')
    expect(body).toContain('`release.json` sets `pre` to `rc`')
    expect(body).toContain('Set it to `null` on main')
    expect(body.endsWith('## 0.1.0-rc.3\n\n_No changelog entry._')).toBe(true)
  })
})

describe('release.json', () => {
  it('names a pre-release identifier or none', () => {
    expect(preReleaseOf('{ "pre": "rc" }')).toBe('rc')
    expect(preReleaseOf('{ "pre": null }')).toBeNull()
    expect(preReleaseOf('{}')).toBeNull()
    expect(() => preReleaseOf('{ "pre": "RC 1" }')).toThrow('release.json: "pre" must be null')
  })

  it('is committed without a pre-release, so main releases final versions', () => {
    expect(preReleaseOf(read('release.json'))).toBeNull()
  })
})

describe('the upgrade fixtures', () => {
  const fixtures = '[\n  { "version": "0.1.0", "steps": 1 },\n  { "version": "0.2.0", "steps": 5 }\n]\n'

  it('gain the final version being prepared, with the schema steps it leaves, in the form the file is kept in', () => {
    expect(withUpgradeFixture(fixtures, '0.3.0', 7)).toBe(
      '[\n  { "version": "0.1.0", "steps": 1 },\n  { "version": "0.2.0", "steps": 5 },\n  { "version": "0.3.0", "steps": 7 }\n]\n',
    )
  })

  it('stay as they are for a pre-release or a version they already hold', () => {
    expect(withUpgradeFixture(fixtures, '0.3.0-rc.1', 7)).toBe(fixtures)
    expect(withUpgradeFixture(fixtures, '0.2.0', 7)).toBe(fixtures)
  })

  it('name every final tag and the final version being released that has none, and skip pre-releases', () => {
    expect(releasesWithoutUpgradeFixture(['v0.1.0-rc.2', 'v0.1.0', 'v0.2.0', ''], '0.2.0', fixtures)).toEqual(
      [],
    )
    expect(releasesWithoutUpgradeFixture(['v0.1.0', 'v0.1.1', 'v0.2.0'], '0.3.0', fixtures)).toEqual([
      '0.1.1',
      '0.3.0',
    ])
    expect(releasesWithoutUpgradeFixture(['v0.2.0'], '0.3.0-rc.1', fixtures)).toEqual([])
  })

  it('refuse a file whose entries are not a version and a positive number of steps', () => {
    for (const broken of ['{}', '[{ "version": "0.1.0" }]', '[{ "version": "0.1.0", "steps": 0 }]', '[null]'])
      expect(() => releasesWithoutUpgradeFixture([], '0.1.0', broken)).toThrow(/each entry must be/)
  })

  it('hold every release tagged in this checkout, and the version every package has', () => {
    const tags = (() => {
      try {
        return execFileSync('git', ['tag', '--list', 'v*'], { cwd: root }).toString().split('\n')
      } catch {
        return []
      }
    })()
    const version = JSON.parse(read('package.json')).version
    expect(
      releasesWithoutUpgradeFixture(tags, version, read('packages/dovecote/test/releases.json')),
    ).toEqual([])
  })
})

describe('the number of schema steps', () => {
  it('counts the entries of the MIGRATIONS list, however they are laid out', () => {
    expect(schemaStepsIn('export const MIGRATIONS: ReadonlyArray<Migration> = [BASELINE, GROUPS]')).toBe(2)
    expect(
      schemaStepsIn('export const MIGRATIONS: ReadonlyArray<Migration> = [\n  BASELINE,\n  GROUPS,\n]\n'),
    ).toBe(2)
  })

  it('refuses a module without the list', () => {
    expect(() => schemaStepsIn('export const STEPS = []')).toThrow(/has no MIGRATIONS list/)
  })
})
