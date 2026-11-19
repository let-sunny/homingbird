# Homingbird

An open-source messenger for AI agents. Colleagues' agents exchange notes; each person teaches their
agent and sees how often its drafts are sent as written. Today a human approves every note before it is
sent. The relay server is **Dovecote**; a message is a **note**.

Read `docs/decisions.md` before changing a design choice and `docs/roadmap.md` before adding a feature.
Anything not in the product brief goes to the roadmap instead of being built.

## Commands

```sh
pnpm install
pnpm typecheck        # tsc over every package
pnpm lint             # biome + scripts/check-style.ts
pnpm format           # biome check --write
pnpm test             # vitest, all packages
pnpm test:coverage    # fails under the thresholds in vitest.config.ts
pnpm test:mutation    # stryker, kernel and protocol; fails under a score of 90
pnpm dev              # Dovecote with development login on http://localhost:8080
pnpm build            # server, CLI, MCP and web bundles
pnpm load-test        # rough throughput numbers for docs/deployment.md
```

Run `pnpm typecheck && pnpm lint && pnpm test` before every commit; `git config core.hooksPath .githooks`
makes git run the first two for you. CI runs all three with coverage, and the Dovecote suite again on
PostgreSQL and MySQL.

## Packages

| Package | Role |
| --- | --- |
| `kernel` | Result, Option, Task, Stream, Schema. No dependencies. Everything else builds on it. |
| `protocol` | Wire model, API contract, note status, messaging policy, the note wrapper. |
| `dovecote` | The relay server. |
| `client` | Typed API client and event stream, derived from the contract. |
| `ui`, `pwa` | Dependency-free web client. |
| `cli`, `mcp`, `a2a` | Command line, MCP adapter, A2A gateway. |
| `mod` | The Claude Code mod: the desk pane, which links each draft to the web client for approval. |

## Rules

The rules below are binding. Details and examples live in `.claude/rules/`.

- @.claude/rules/code-style.md
- @.claude/rules/functional-core.md
- @.claude/rules/dependencies.md
- @.claude/rules/testing.md
- @.claude/rules/security.md
- @.claude/rules/web-client.md

## Naming and language

- Everything public is English: code, comments, docs, UI strings, commit messages.
- Never put "Claude" or any vendor trademark in a product, package, or repository name.
- Commit messages follow Conventional Commits: `<type>(<scope>): <summary>`, type one of `feat`,
  `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`; scope, when present, a package
  name or `deploy`, `release`, `repo`; summary imperative, lower-case, no period, at most 72
  characters; `!` or a `BREAKING CHANGE:` footer for a breaking change. The body says why the change
  was made: that is where history lives, not in comments. `.githooks/commit-msg` checks it.
- Commit types decide the version and the release notes: `feat`, `fix` and `perf` and breaking changes
  are released, and their summary and first body paragraph become the release notes. Write those two
  for the people who use Homingbird.
