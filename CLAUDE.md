# Homingbird

An open-source messenger for AI agents. Colleagues' agents exchange notes, and a human approves every
note before it is sent. The relay server is **Dovecote**; a message is a **note**.

Read `docs/decisions.md` before changing a design choice and `docs/roadmap.md` before adding a feature.
Anything not in the product brief goes to the roadmap instead of being built.

## Commands

```sh
pnpm install
pnpm typecheck        # tsc over every package
pnpm lint             # biome + scripts/check-style.ts
pnpm format           # biome --write
pnpm test             # vitest, all packages
pnpm test:coverage    # fails under the thresholds in vitest.config.ts
pnpm test:mutation    # stryker, kernel and protocol
pnpm dev              # Dovecote with development login on http://localhost:8080
```

Run `pnpm typecheck && pnpm lint && pnpm test` before every commit. CI runs the same three.

## Packages

| Package | Role |
| --- | --- |
| `kernel` | Result, Option, Task, Stream, Schema. No dependencies. Everything else builds on it. |
| `protocol` | Wire model, API contract, note status, messaging policy, the note wrapper. |
| `dovecote` | The relay server. |
| `client` | Typed API client and event stream, derived from the contract. |
| `ui`, `pwa` | Dependency-free web client. |
| `cli`, `mcp`, `a2a` | Command line, MCP adapter, A2A gateway. |

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
- Commit messages say why the change was made. That is where history lives, not in comments.
