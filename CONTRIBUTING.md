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

## Security

Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md). Do not open a public
issue.
