import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  hasPendingChangesets,
  pendingSummaries,
  releaseNotes,
  releasePlan,
  syncedFiles,
  versionPullRequest,
  versionsIn,
  withRelease,
} from '../release-version.ts'

const root = join(import.meta.dirname, '..', '..')
const read = (file: string): string => readFileSync(join(root, file), 'utf8')

describe('the oldest Claude Code the mod supports', () => {
  it('is the same in the mod, its manifest and its README', () => {
    const declared = /MINIMUM_HOST_VERSION = '([^']+)'/.exec(read('packages/mod/hooks/host-support.ts'))?.[1]
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/)
    expect(JSON.parse(read('packages/mod/.claude-plugin/plugin.json')).engines['claude-code']).toBe(
      `>=${declared}`,
    )
    expect(read('packages/mod/README.md')).toContain(`Claude Code ${declared} or newer`)
    expect(read('packages/mod/hooks/pane-text/en.ts')).toContain(`Claude Code to ${declared} or newer`)
  })
})

describe('the version of every package', () => {
  it('is the same in every workspace package, the root, the mod manifest, the marketplace entry and both version constants', () => {
    const packages = readdirSync(join(root, 'packages')).filter((name) => {
      try {
        return read(`packages/${name}/package.json`) !== ''
      } catch {
        return false
      }
    })
    const versions = versionsIn(read, packages)
    expect(versions.size).toBe(packages.length + 5)
    expect(new Set(versions.values()).size).toBe(1)
  })

  it('is set in the root, the mod manifest, the marketplace entry and both version constants by one sync', () => {
    const marketplace = (version: string) =>
      `{\n  "name": "homingbird",\n  "plugins": [\n    {\n      "name": "homingbird",\n      "source": { "source": "npm", "package": "@homingbird/mod", "version": "${version}" }\n    }\n  ]\n}\n`
    const files: Record<string, string> = {
      'package.json': '{\n  "name": "homingbird",\n  "version": "0.1.0-rc.2",\n  "private": true\n}\n',
      'packages/mod/.claude-plugin/plugin.json': '{\n  "name": "homingbird",\n  "version": "0.1.0-rc.2"\n}\n',
      '.claude-plugin/marketplace.json': marketplace('0.1.0-rc.2'),
      'packages/mcp/src/version.ts': "export const ADAPTER_VERSION = '0.1.0-rc.2'\n",
      'packages/dovecote/src/version.ts': "export const SERVER_VERSION = '0.1.0-rc.2'\n",
    }
    const synced = syncedFiles('0.1.0', (file) => files[file]!)
    expect(Object.fromEntries(synced.map(({ file, text }) => [file, text]))).toEqual({
      'package.json': '{\n  "name": "homingbird",\n  "version": "0.1.0",\n  "private": true\n}\n',
      'packages/mod/.claude-plugin/plugin.json': '{\n  "name": "homingbird",\n  "version": "0.1.0"\n}\n',
      '.claude-plugin/marketplace.json': marketplace('0.1.0'),
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

  it('turns the Unreleased section into the release, keeping what it says and adding the changesets', () => {
    const before = `${HEAD}## [Unreleased]\n\nThe first release.\n\n### Known limits\n\n- One process.\n\n[Unreleased]: https://example.com\n`
    expect(withRelease(before, '0.1.0', '2026-11-20', ['- Removed the general channel.'])).toBe(
      `${HEAD}## [0.1.0] - 2026-11-20\n\nThe first release.\n\n### Known limits\n\n- One process.\n\n### Changes\n\n- Removed the general channel.\n\n[0.1.0]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0\n`,
    )
  })

  it('adds a new release above the earlier ones, with its link above theirs', () => {
    const before = `${HEAD}## [0.1.0] - 2026-11-20\n\nFirst.\n\n[0.1.0]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0\n`
    const after = withRelease(before, '0.1.1', '2026-12-01', ['- Fixed sign-in.', '- Faster search.'])
    expect(after).toBe(
      `${HEAD}## [0.1.1] - 2026-12-01\n\n### Changes\n\n- Fixed sign-in.\n\n- Faster search.\n\n## [0.1.0] - 2026-11-20\n\nFirst.\n\n[0.1.1]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.1\n[0.1.0]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0\n`,
    )
  })

  it('handles a changelog with no release and no links yet, and a release with no changesets', () => {
    expect(withRelease(HEAD, '0.1.0', '2026-11-20', [])).toBe(
      `${HEAD.trimEnd()}\n\n## [0.1.0] - 2026-11-20\n\n[0.1.0]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0\n`,
    )
    expect(withRelease(`${HEAD}## [Unreleased]\n\nNotes.`, '0.2.0', '2027-01-01', [])).toContain(
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

  it('takes each changeset’s text without its header, and drops empty ones', () => {
    expect(
      pendingSummaries([
        '---\n"@homingbird/cli": patch\n---\n\n- Removed the general channel.\n',
        '---\n"@homingbird/cli": patch\n---\n\nSkip with a reason.\n',
        '---\n---\n',
      ]),
    ).toEqual(['- Removed the general channel.', 'Skip with a reason.'])
  })

  it('puts the first pre-release above the link references', () => {
    const before = `${HEAD}## [Unreleased]\n\nNotes.\n\n[0.0.9]: https://x\n`
    expect(withRelease(before, '0.1.0-rc.1', '2026-11-20', ['- One.'])).toBe(
      `${HEAD}## [Unreleased]\n\nNotes.\n\n## [0.1.0-rc.1] - 2026-11-20\n\n### Changes\n\n- One.\n\n[0.1.0-rc.1]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0-rc.1\n[0.0.9]: https://x\n`,
    )
  })

  it('puts a pre-release below the Unreleased section, which waits for the final version', () => {
    const before = `${HEAD}## [Unreleased]\n\nThe first release.\n\n## [0.1.0-rc.2] - 2026-11-10\n\nOld.\n`
    const after = withRelease(before, '0.1.0-rc.3', '2026-11-20', ['- Skip with a reason.'])
    expect(after).toContain(
      '## [Unreleased]\n\nThe first release.\n\n## [0.1.0-rc.3] - 2026-11-20\n\n### Changes\n\n- Skip with a reason.\n\n## [0.1.0-rc.2]',
    )
    expect(releaseNotes(after, '0.1.0-rc.3')).toBe('### Changes\n\n- Skip with a reason.')
  })
})

describe('the Version Packages pull request', () => {
  it('is wanted only while a changeset waits in .changeset', () => {
    expect(hasPendingChangesets(['README.md', 'config.json', 'pre.json'])).toBe(false)
    expect(hasPendingChangesets(['README.md', 'config.json', 'brave-cats.md'])).toBe(true)
  })

  it('names the version, says what merging does, and carries the changelog section', () => {
    const { title, body } = versionPullRequest('0.1.0', null, '### Changes\n\n- Skip with a reason.')
    expect(title).toBe('Version Packages')
    expect(body).toContain('Merging this pull request releases **0.1.0**')
    expect(body).toContain('tags v0.1.0')
    expect(body.endsWith('## 0.1.0\n\n### Changes\n\n- Skip with a reason.')).toBe(true)
    expect(body).not.toContain('pre mode')
  })

  it('marks a pre-release in the title and says how to leave pre mode', () => {
    const { title, body } = versionPullRequest('0.1.0-rc.3', 'rc', '')
    expect(title).toBe('Version Packages (rc)')
    expect(body).toContain('main is in pre mode (`rc`)')
    expect(body).toContain('pnpm changeset pre exit')
    expect(body.endsWith('## 0.1.0-rc.3\n\n_No changelog entry._')).toBe(true)
  })
})
