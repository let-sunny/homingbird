# Code style

## Lead with the answer

Every file answers one question, and its name is that question. The first declaration after the imports
is the export that answers it. Supporting exports follow in order of importance. Private helpers,
constants and row types go at the bottom.

```ts
// notes.ts
export const sendDraft = ...      // what the file is for
export const discardDraft = ...
const settleReply = ...           // how, for readers who keep going
const MAX_OPEN_DRAFTS = 200
```

- If a private constant must be evaluated before an export can be declared, move it to its own file.
- If a file cannot be read top-down, it is doing two things. Split it.
- The same applies inside a function: the main path first, guard clauses before it, details extracted
  into named helpers below.
- The same applies to documents, commit messages and pull requests: conclusion first.

## Names carry the meaning

- Name things so that no comment is needed: `requireMayMessage`, `notesAwaitingReply`, `PICKUP_GRACE_MS`.
- No abbreviations except `id`, `url`, and loop-local single letters in three-line scopes.
- A function that can fail is named for what it requires or attempts; a predicate starts with `is`, `has`,
  `can` or `may`.

## Comments

- Default to none. A comment is allowed only for a constraint the code cannot express, such as a
  protocol requirement or a browser quirk.
- Never write history ("changed from", "used to", "added for", "fix for", ticket numbers, dates,
  author names). `git blame` and the commit message hold that.
- Never restate what the code does.
- No commented-out code. No `TODO` without an entry in `docs/roadmap.md`.

## Formatting

Biome decides. Do not hand-format, and do not disable a lint rule inline without a one-line reason.
