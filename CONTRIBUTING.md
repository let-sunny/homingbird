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

Node 22.18 or newer and pnpm 10.

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

CI runs these with the coverage thresholds, runs the Dovecote suite again against PostgreSQL and
MySQL, and builds and starts the Docker image. A pull request that lowers a threshold, disables a lint
rule, or skips a test will not be merged.

Changes to `kernel` or `protocol` also need `pnpm test:mutation` to stay at a score of 90 or more.

To run the Dovecote suite against a database of your own, point the harness at it and run the files one
at a time, because each test recreates the tables:

```sh
HB_TEST_DATABASE_URL=postgres://homingbird:homingbird@localhost:5432/homingbird \
  npx vitest run packages/dovecote/ --no-file-parallelism
```

`HB_TEST_POSTGRES_URL` and `HB_TEST_MYSQL_URL` add those databases to the dialect scenarios in
`packages/dovecote/test/dialects.test.ts`.

## What the tooling fixes for you

| Concern | Tool | Config |
| --- | --- | --- |
| Whitespace, line endings | EditorConfig | `.editorconfig` |
| Formatting, imports, lint | Biome | `biome.json` |
| File layout, comment policy, package names, test files | `scripts/check-style.ts` | `.claude/rules/code-style.md` |
| Types | TypeScript, strict | `tsconfig.base.json` |
| Tests, coverage | Vitest | `vitest.config.ts` |
| Mutation testing | Stryker | `stryker.config.json` |

## Commits and pull requests

- One logical change per commit. The subject says what changed; the body says why.
- Explanations belong in the commit message, not in code comments.
- Record a new design decision in `docs/decisions.md` in the same pull request.

## Releasing

A tag `v<version>` on `main` releases that version. `.github/workflows/release.yml` checks it, then
publishes `@homingbird/cli`, `@homingbird/mcp` and `@homingbird/mod` to npm with provenance and pushes
`ghcr.io/let-sunny/homingbird:<version>` (also `<major>.<minor>` and, for a version without a
pre-release part, `latest`). Every other package is `private` and never published.

### Cut a version

```sh
pnpm set-version 0.2.0            # every package.json, the mod's plugin.json, the two version constants
pnpm typecheck && pnpm lint && pnpm test
git commit -am "Release 0.2.0"    # with a body that says what the release brings
git tag v0.2.0
git push origin main v0.2.0
```

The workflow sets the version from the tag again, so the tag decides what is published. A version
with a pre-release part, such as `v0.2.0-rc.1`, goes to the npm dist-tag `next`; people and the mod's
marketplace entry get `latest` only. A version already on npm is skipped, so a failed run can be run
again. To try a release without publishing, run the workflow's pack and smoke-test steps locally:
`pnpm build`, then `pnpm pack` in `packages/cli`, `packages/mcp` and `packages/mod`, install the CLI
and MCP tarballs into an empty directory with `npm install`, and run `homingbird --help`.

To try the mod from a checkout, run `pnpm build` (it copies the CLI bundle to
`packages/mod/cli/homingbird.mjs`) and start Claude Code with `claude --plugin-dir packages/mod`.
`claude plugin validate packages/mod` and `claude plugin test packages/mod` check it.

### One-time setup by the repository owner

1. **npm scope.** Create the npm organization `homingbird` (npmjs.com, Add Organization) so that the
   `@homingbird` scope exists, and make the publishing account an owner. Turn on two-factor
   authentication for that account.
2. **The first publish uses a token**, because npm offers trusted publishing only for a package that
   already exists. Create a granular access token on npmjs.com with read and write access to the
   `@homingbird` scope (or all packages of the organization) and "Bypass two-factor authentication"
   checked, and save it as the repository secret
   `NPM_TOKEN` (Settings, Secrets and variables, Actions). Push the first tag.
3. **Then switch to trusted publishing.** For each of `@homingbird/cli`, `@homingbird/mcp` and
   `@homingbird/mod`, open the package's Settings on npmjs.com, add a trusted publisher of type GitHub
   Actions with organization or user `let-sunny`, repository `homingbird`, workflow filename
   `release.yml` and environment `npm`. Then set "Require two-factor authentication and disallow
   tokens" and delete the `NPM_TOKEN` secret and the token. The workflow needs no change: npm 11.5.1
   or newer uses the workflow's OIDC identity when no token is set.
4. **The `npm` environment.** The publishing job runs in the GitHub environment `npm`, which GitHub
   creates on the first run. Under Settings, Environments, `npm`, limit deployment to tags matching
   `v*`, and add required reviewers if a person should confirm each publish.
5. **GHCR.** The image job pushes with the workflow's own `GITHUB_TOKEN` (`packages: write`); no
   secret is needed. Under Settings, Actions, General, Workflow permissions may stay read-only, since
   the workflow asks for `packages: write` itself. After the first push, open the package
   `homingbird` under the owner's Packages, set its visibility to **Public** (it starts private), and
   check that it is linked to this repository.
6. **Tag protection.** Optionally add a ruleset for tags `v*` so that only maintainers can create them.

## Security

Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md). Do not open a public
issue.
