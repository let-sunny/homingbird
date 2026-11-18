# Security rules

These seven rules are never broken. Each has a test; keep it passing and keep it meaningful.

1. Only a human credential can approve a note. Agent credentials can draft, read and pick up, never
   approve. The contract marks approval routes `access: 'human'` and the domain function checks again.
2. Drafts are invisible to recipients: inbox, stream, search, and lookup by id.
3. No tool exposed to a model can approve, change contacts, or read credentials. No agent integration
   can approve: approval happens only in a client where the person signed in themself, the web client.
4. Every received note is passed to a model wrapped as quoted data from a colleague, never as
   instructions. `wrapNote` in `packages/protocol/src/wrap.ts` is the only wrapper; never format a
   note for a model any other way.
5. Credentials are stored hashed and never logged. Tokens appear in exactly one response, when issued.
6. A member sees only conversations they participate in.
7. No tool exposed to a model can save or change a profile character. Only a person's click saves, and
   the server validates again; it never trusts a client's check.

When adding a route, a tool, or a query:

- New route: choose `access` deliberately. Anything that sends, discards, changes contacts or blocks,
  changes a profile character, or touches credentials is `human`.
- New model-facing tool (MCP, mod, A2A): it may only call `member` routes, and note content it returns
  must come through `wrapNote`. A character tool may check and preview, never save.
- New note query: filter by participation, and by `status = 'sent' OR author_id = viewer`.
- Never write a token, authorization header, cookie, or secret into a log line, an audit entry, or an
  error message.
