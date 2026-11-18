# Contributing to Homingbird

Two contributors solving the same problem here should produce the same code. The tooling and the
written rules exist to make that true.

## Before you start

1. Read [`CLAUDE.md`](CLAUDE.md) and the files in [`.claude/rules/`](.claude/rules/). They are short
   and they are binding, whether you write the code yourself or with a coding agent.
2. Check [`docs/roadmap.md`](docs/roadmap.md). Features outside the product brief are discussed there
   first.
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

  A removed topic kept collecting questions nobody would answer.
  ```

  The first line is `<type>(<scope>): <summary>`. Types: `feat`, `fix`, `docs`, `test`, `refactor`,
  `perf`, `build`, `ci`, `chore`. The scope is optional; when present it is a package (`kernel`,
  `protocol`, `dovecote`, `client`, `ui`, `pwa`, `cli`, `mcp`, `a2a`, `mod`, `sprites`) or `deploy`,
  `release`, `repo`. The summary is imperative, starts lower-case, has no trailing period and at most
  72 characters. Mark a breaking change with `!` before the colon or a `BREAKING CHANGE:` footer.
  The body says why; trailers such as `Co-Authored-By:` may follow it. Merge commits and the release
  bot's "Version Packages" commits are exempt.
- `git config core.hooksPath .githooks` checks each message as you commit
  (`scripts/check-commit-message.ts`), and CI checks every commit of a pull request.
- Commit types do not decide versions: changesets do.
- Explanations belong in the commit message, not in code comments.
- Record a new design decision in `docs/decisions.md` in the same pull request.

## Releasing

`@homingbird/cli`, `@homingbird/mcp`, `@homingbird/mod` and the image `ghcr.io/let-sunny/homingbird`
are published; every other package is `private` and never published. All packages share one version,
decided by [Changesets](https://github.com/changesets/changesets).

### With each change

Add a changeset in the same pull request:

```sh
pnpm changeset          # pick patch, minor or major, and write a sentence or two for users
pnpm changeset --empty  # a change that needs no release, such as a docs fix
```

CI fails a pull request that changes a package without a changeset.

### Releasing

On every push to `main`, `.github/workflows/release.yml` opens or updates the pull request
"Version Packages", which sets the next version everywhere and moves the changesets into
[`CHANGELOG.md`](CHANGELOG.md), below the `Unreleased` notes. **Merging that pull request releases:**
the workflow runs typecheck, lint and tests, builds, publishes the three packages to npm with
provenance (dist-tag `latest`, or `next` for a pre-release), creates the tag `v<version>` and the GitHub
release with that version's changelog section, and pushes `ghcr.io/let-sunny/homingbird:<version>`
(also `<major>.<minor>` and, for a version without a pre-release part, `latest`). A version that is
already tagged and on npm is skipped, so a failed run can be run again.

The "Version Packages" pull request is opened with `GITHUB_TOKEN`, which starts no CI on it. The
release job therefore runs the checks itself before it publishes.

### Pre-releases

```sh
pnpm changeset pre enter rc   # commit and push: the next Version Packages PR makes 0.1.0-rc.3
pnpm changeset pre exit       # commit and push: the next one makes 0.1.0
```

Without pre mode, the next version follows from the changesets: from `0.1.0-rc.2` a patch changeset
makes `0.1.0`.

### Repository settings

- Settings, Actions, General: turn on **Allow GitHub Actions to create and approve pull requests**.
- npmjs.com, each package's trusted publisher: workflow `release.yml`, environment `npm`.
- Settings, Environments, `npm`: allow deployments from the branch `main`, and add required reviewers
  if a person should confirm each publish.

To try a release without publishing, run the workflow's pack and smoke-test steps locally:
`pnpm build`, then `pnpm pack` in `packages/cli`, `packages/mcp` and `packages/mod`, install the CLI
and MCP tarballs into an empty directory with `npm install`, and run `homingbird --help`.

To try the mod from a checkout, run `pnpm build` (it copies the CLI bundle to
`packages/mod/cli/homingbird.mjs`) and start Claude Code with `claude --plugin-dir packages/mod`.
`claude plugin validate packages/mod` and `claude plugin test packages/mod` check it.

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
