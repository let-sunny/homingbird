# Contributing to Homingbird

Two contributors solving the same problem here should produce the same code. The tooling and the
written rules exist to make that true.

## Before you start

1. Read [`CLAUDE.md`](CLAUDE.md) and the files in [`.claude/rules/`](.claude/rules/). They are short
   and they are binding, whether you write the code yourself or with a coding agent.
2. Check [`docs/roadmap.md`](docs/roadmap.md). Features outside this release are listed in roadmap
   order there; discuss them first.
3. Check [`docs/decisions.md`](docs/decisions.md) before reopening a design choice.

## Setup

Node 22.18 or newer and pnpm 10. Development runs TypeScript files directly, which Node supports from
22.18; the published packages are bundled and need only Node 22. If your shell loads nvm lazily, run
`nvm use` (or check that `node -v` works) before `pnpm dev`.

```sh
pnpm install
pnpm dev
```

Turn on the pre-commit hook once per clone. It runs `pnpm typecheck` and `pnpm lint` before each commit:

```sh
git config core.hooksPath .githooks
```

`pnpm format` fixes most of what `pnpm lint` reports.

## The checks

```sh
pnpm typecheck && pnpm lint && pnpm test
```

CI runs these with the coverage thresholds on Node 22 and 24, runs the Dovecote suite again against
PostgreSQL and MySQL, builds and starts the Docker image, and checks the Terraform setups with
`terraform fmt -check`, `terraform init -backend=false` and `terraform validate`. A pull request that lowers a threshold, disables a lint
rule, or skips a test will not be merged.

Changes to `kernel` or `protocol` also need `pnpm test:mutation` to stay at a score of 90 or more.

To run the Dovecote suite against a database of your own, point the harness at it and run the files one
at a time, because each test recreates the tables:

```sh
HB_TEST_DATABASE_URL=postgres://homingbird:homingbird@localhost:5432/homingbird \
  npx vitest run packages/dovecote/ --no-file-parallelism
```

`HB_TEST_POSTGRES_URL` and `HB_TEST_MYSQL_URL` add those databases to the dialect scenarios in
`packages/dovecote/test/dialects.test.ts`. `HB_TEST_POSTGRES_SOCKET_URL`, a URL whose host is a Unix
socket directory such as `postgres://homingbird:homingbird@/homingbird?host=/var/run/postgresql`, runs
the socket tests in `packages/dovecote/test/postgres.test.ts`, the shape Cloud SQL needs.

## What the tooling fixes for you

| Concern | Tool | Config |
| --- | --- | --- |
| Whitespace, line endings | EditorConfig | `.editorconfig` |
| Formatting, imports, lint | Biome | `biome.json` |
| File layout, comment policy, package names, test files | `scripts/check-style.ts` | `.claude/rules/code-style.md` |
| Types | TypeScript, strict | `tsconfig.base.json` |
| Tests, coverage | Vitest | `vitest.config.ts` |
| Mutation testing | Stryker | `stryker.config.json` |

### Pinned actions

Every action in `.github/workflows/` is pinned to a full commit SHA, with its tag as a trailing comment,
so that a moved tag cannot change what runs. To update one, look up the commit of the new tag and
replace both:

```sh
git ls-remote https://github.com/actions/checkout 'refs/tags/v7' 'refs/tags/v7^{}'
```

For an annotated tag, use the commit on the `^{}` line; otherwise the only line is the commit.

## Commits and pull requests

- One logical change per commit, written as a Conventional Commit:

  ```
  fix(dovecote): refuse drafts in an archived room

  A removed channel kept collecting questions nobody would answer.
  ```

  The first line is `<type>(<scope>): <summary>`. Types: `feat`, `fix`, `docs`, `test`, `refactor`,
  `perf`, `build`, `ci`, `chore`. The scope is optional; when present it is a package (`kernel`,
  `protocol`, `dovecote`, `client`, `ui`, `pwa`, `cli`, `mcp`, `a2a`, `plugin`, `sprites`) or `deploy`,
  `release`, `repo`. The summary is imperative, starts lower-case, has no trailing period and at most
  72 characters. Mark a breaking change with `!` before the colon or a `BREAKING CHANGE:` footer.
  The body says why; trailers such as `Co-Authored-By:` may follow it. Merge commits and the release
  bot's "Version Packages" commits are exempt.
- `git config core.hooksPath .githooks` checks each message as you commit
  (`scripts/check-commit-message.ts`), and CI checks every commit of a pull request.
- Commit types decide versions and release notes: see [Releasing](#releasing). Write the summary and
  the first paragraph of the body of a `feat`, `fix` or `perf` commit for the people who use Homingbird.
- Explanations belong in the commit message, not in code comments.
- Record a new design decision in `docs/decisions.md` in the same pull request.

## Releasing

`@homingbird/cli`, `@homingbird/mcp`, `@homingbird/mod` and the image `ghcr.io/let-sunny/homingbird`
are published; every other package is `private` and never published. All packages share one version,
decided by the commit messages.

### With each change

Nothing beyond the commit message. The commits since the last `v*` tag decide the next version:

| Commits since the last release | Before 1.0 | From 1.0 |
| --- | --- | --- |
| A breaking change (`!` or a `BREAKING CHANGE:` footer) | minor | major |
| A `feat` | patch | minor |
| A `fix` or `perf` | patch | patch |
| Only `chore`, `docs`, `test`, `ci`, `build`, `refactor` | no release | no release |

The release notes are made from the same commits, grouped under "Breaking changes", "Added", "Fixed"
and "Performance". Each entry is the summary, with its scope in front, and the first paragraph of the
body; a breaking change adds its `BREAKING CHANGE:` text. Write those for the people who use
Homingbird. Merge commits and the "Version Packages" commits are skipped.

`pnpm release:preview` prints the version and notes the next release would have;
`pnpm release:preview <ref>` counts from another commit or tag.

### Releasing

On every push to `main`, `.github/workflows/release.yml` works out the next version. When there is
one, it rebuilds the branch `release/main` from `main`, runs `node scripts/release-version.ts prepare`
there (the version everywhere, and a new `## [<version>] - <date>` section in
[`CHANGELOG.md`](CHANGELOG.md)), force-pushes it, and opens or updates the pull request "Version
Packages" with `gh`; its body is that section. To change the notes, edit the section in `CHANGELOG.md`
on `release/main` before merging: the release takes its notes from the merged `CHANGELOG.md`. A later
push to `main` rebuilds the branch and drops such an edit, so edit just before merging.

**Merging that pull request releases:**
the workflow runs typecheck, lint and tests, builds, publishes the three packages to npm with
provenance (dist-tag `latest`, or `next` for a pre-release), creates the tag `v<version>` and the GitHub
release with that version's changelog section, and pushes `ghcr.io/let-sunny/homingbird:<version>`
(also `<major>.<minor>` and, for a version without a pre-release part, `latest`). A version that is
already tagged and on npm is skipped, so a failed run can be run again.

The "Version Packages" pull request is opened with `GITHUB_TOKEN`, which starts no CI on it. The
release job therefore runs the checks itself before it publishes.

**Upgrades from every release are tested.** `prepare` also adds the new final version, with the number
of schema steps it leaves, to `packages/dovecote/test/releases.json`; the upgrade tests then build a
database as that release left it and start every later server on it. `node scripts/release-version.ts
check`, which the release workflow runs on every push to `main`, fails while a final `v*` tag or the
version being released has no entry there. When a release adds a schema step, give its new tables and
columns realistic rows in `packages/dovecote/test/upgrade-support.ts` before releasing it.

### Pre-releases

`release.json` at the root holds one setting, `"pre"`:

- `{ "pre": "rc" }`: the next release is a pre-release. From `0.1.0`, a `fix` makes `0.1.1-rc.1`;
  while the latest tag is a `-rc` version, each release with commits for users counts up (`-rc.2`,
  `-rc.3`) and keeps its version.
- `{ "pre": null }`: final versions. From `0.1.1-rc.3`, the next release is `0.1.1`, whatever the
  commits since.

Commit the change to `main` like any other.

### Repository settings

- Settings, Actions, General: turn on **Allow GitHub Actions to create and approve pull requests**.
- npmjs.com, each package's trusted publisher: workflow `release.yml`, environment `npm`.
- Settings, Environments, `npm`: allow deployments from the branch `main`, and add required reviewers
  if a person should confirm each publish.

To try a release without publishing, run the workflow's pack and smoke-test steps locally:
`pnpm build`, then `pnpm pack` in `packages/cli`, `packages/mcp` and `packages/plugin`, install the CLI
and MCP tarballs into an empty directory with `npm install`, and run `homingbird --help`.

To try the plugin from a checkout, run `pnpm build` (it copies the CLI bundle to
`packages/plugin/cli/homingbird.mjs`) and start Claude Code with `claude --plugin-dir packages/plugin`.
`pnpm test:plugin` checks it with `claude plugin validate` and `claude plugin test`: the plugin's tests
import the host's `claude-code/testing` kit and run in its environment, so they need Claude Code
installed and are not part of `pnpm test`.

### Publishing from a fork

This repository is set up already. To publish a fork under your own npm scope and registry, change
the package names and image, then:

1. **npm scope.** Create an npm organization for the scope and make the publishing account an owner
   with two-factor authentication.
2. **First publish by hand.** npm offers trusted publishing only for a package that exists, so publish
   the first version of each package from your machine with `npm publish --access public`.
3. **Then trusted publishing.** For each package on npmjs.com, add a trusted publisher of type GitHub
   Actions with your repository, workflow `release.yml` and environment `npm`; require two-factor
   authentication and disallow tokens. npm 11.5.1 or newer, which the workflow installs, uses the
   workflow's OIDC identity.
4. **The `npm` environment.** Under Settings, Environments, `npm`, allow deployments from `main`, and
   add required reviewers if a person should confirm each publish.
5. **GHCR.** The image job pushes with the workflow's own `GITHUB_TOKEN` (`packages: write`). After
   the first push, make the package public and link it to the repository.
6. **Tag protection.** Optionally add a ruleset so that only maintainers can create `v*` tags.

## Security

Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md). Do not open a public
issue.
