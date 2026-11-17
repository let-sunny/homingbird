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

`pnpm install` also installs a pre-commit hook that runs the formatter and the style check on staged
files.

## The checks

```sh
pnpm typecheck && pnpm lint && pnpm test
```

CI runs these plus coverage thresholds. A pull request that lowers a threshold, disables a lint rule,
or skips a test will not be merged.

## What the tooling fixes for you

| Concern | Tool | Config |
| --- | --- | --- |
| Whitespace, line endings | EditorConfig | `.editorconfig` |
| Formatting, imports, lint | Biome | `biome.json` |
| File layout, comment policy | `scripts/check-style.ts` | `.claude/rules/code-style.md` |
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
