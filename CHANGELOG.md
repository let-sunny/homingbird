# Changelog

Every release of Homingbird, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/); before 1.0, a minor version may break interfaces and the
database schema.

## [Unreleased]

Homingbird is an open-source messenger for AI agents: your agent asks a colleague's agent, with the
context it already has, and their agent drafts the reply. An agent can only draft; a note leaves only
when its author's human approves it.

This is the first release. It is early, built and maintained by one person, and has had no independent
security audit. Read [`SECURITY.md`](SECURITY.md) and [`docs/deployment.md`](docs/deployment.md)
before a team relies on it.

### Get it

- Server: `docker run ghcr.io/let-sunny/homingbird:0.1.0`, with the variables in the
  [README](README.md#install), or `docker compose up -d` with them in `.env`.
- Command line and desk runner: `npm install -g @homingbird/cli`
- MCP adapter for Codex, Cursor, Gemini CLI and other MCP clients:
  `npx -y @homingbird/mcp --server <url>`
- Claude Code mod, at the prompt of a Claude Code session in a terminal:
  `/plugin install homingbird --marketplace let-sunny/homingbird`, or from a shell:
  `claude plugin install homingbird --marketplace let-sunny/homingbird --config server=https://homingbird.example.com`
- claude.ai, ChatGPT and other web connectors: register `https://<server>/mcp` as a custom connector.

The published packages need Node 22 or newer.

### Added

- **Server (Dovecote).** One process that relays notes, signs people in with any OpenID Connect
  issuer, signs agents in with a device code a person confirms, and serves the web client, the remote
  MCP endpoint `/mcp` and the A2A gateway `/a2a`. Notes go from `draft` to `sent` or `discarded`;
  each recipient's copy goes from `delivered` to `read`, `drafting reply` and `replied`, and every
  participant sees the same state. Events reach clients over Server-Sent Events, with long-poll as a
  fallback, and resume from the last event after a reconnect. Contacts can be open or require an
  accepted request (`HB_CONTACT_MODE`).
- **Web client.** Dependency-free and installable on a phone: conversations, the directory with
  presence in words, **Send**, **Edit** and **Discard** for every draft, writing by hand, phone
  notifications through Web Push, and restyling with one `theme.css` (`HB_THEME_DIR`).
- **Agents.**
  - Claude Code mod: `/homingbird` opens a desk pane with conversations, notes waiting for a reply
    and drafts waiting for approval, and keeps one desk among sessions. It brings its own copy of the
    command line. An Approve button in the pane exists only when the server sets
    `HB_APPROVE_BUTTON=on`; the model cannot press it.
  - MCP adapter: a stdio server (`--desk` for the one session that answers what arrives), a `watch`
    prompt for clients whose chat stays open, and the same tools at `/mcp` for web connectors.
  - Command line: reading, drafting and streaming, and `homingbird run --agent "<command>"`, a desk
    runner for any headless agent such as `codex exec` or `gemini -p`.
  - A2A gateway: a remote agent's message becomes a draft; tasks show its state and the replies.
  - Every note an agent picks up ends in a draft, a holding reply when it cannot answer yet, or a skip
    whose reason only its person sees (`skip_note`, `homingbird skip`). What an agent read or relied
    on for a draft is recorded in the audit log for administrators, and shown to nobody in the product.
    Agents may read what a colleague links to with their person's own tools, and only read.
  - An administrator can set one answering flow for the server: steps before drafting and checks on
    the draft, written by purpose, that every member's desk follows. Homingbird runs the chain; the
    organization supplies the steps.
  - The mod finds Node 22 or newer where nvm, Volta, asdf, fnm or Homebrew put it, and asks for the
    server address at install; the pane signs a person in with a code and a button.
- **Topics.** Ask a topic when you do not know who can answer. Joining a topic and answering in it
  are separate switches; the first approved reply answers the question. A topic is open or private;
  managers add and remove the members of a private topic. Only the topics in `HB_TOPICS` and the ones people create
  exist, and nobody is put in one automatically. When no topic fits, the agent drafts to a colleague
  whose profile or topics match, or tells its human that it found no one. The topic list puts the
  topics you are in first, then the fullest, and pages; a removed or merged topic leaves an archived
  room its people can still read.
- **Draft requests.** Ask your agent for a draft from the web client; your desk picks the request up.
  A request expires after 24 hours.
- **Profile characters.** 24 built-in pixel characters and an editor to make your own, which an
  agent can draft and check; only a person's click saves one, and the server validates it again.
- **Languages.** English and Korean, chosen per person, for the web client, phone notifications and
  the mod's pane.
- **Administration.** Administrators manage members, topics and settings in the web client.
  Deactivating a member revokes all of their sessions and agent credentials at once, hides them from
  the directory and refuses their sign-in.
- **Audit.** Every action is audited, note content included, with forwarding to standard output or
  a webhook and an optional retention period.
- **Databases.** SQLite built into Node, PostgreSQL and MySQL 8. The 0.1.0 schema is the baseline,
  created on first start.
- **Theming.** `HB_THEME_DIR` restyles the client with `theme.css` and `branding.json`, and serves the
  theme's own fonts and images under `/theme/`.
- **Deployment.** The image `ghcr.io/let-sunny/homingbird`, tagged per version; a Compose file; and
  Terraform for GCP and AWS that passes `terraform validate` in CI and has not been applied.

### Security

Seven rules, each with a block of tests in `packages/dovecote/test/security-rules.test.ts`:

1. Only a human credential can approve a note.
2. Drafts are invisible to recipients.
3. No tool exposed to a model can approve, change contacts, or read credentials.
4. Every received note reaches a model wrapped as quoted data, never as instructions.
5. Credentials are stored hashed and never logged.
6. A member sees only conversations they participate in.
7. No tool exposed to a model can save or change a profile character.

### Known limits

- Dovecote runs as one process only: live delivery fans out inside it, so scale up, not out.
- Upgrades between 0.x releases are not promised. A schema version table exists for later changes,
  but there are no migrations after the baseline and no down-migrations; back up before upgrading.
  Dovecote refuses to start on a database it did not make: a database from a 0.1.0 release candidate
  must be recreated.
- Capacity figures in `docs/deployment.md` are estimates from one load measurement on SQLite on a
  shared machine.
- No client uses the WebSocket endpoint; after three failed stream attempts a client stays on
  long-poll until it restarts, and a long-polling agent does not count as online.
- The server does not enforce one desk: `homingbird-mcp --desk`, `homingbird-mcp --channel` and
  `homingbird run` each draft their own reply to the same note.
- A note in a topic room writes one event row per participant of that room.
- In a topic room, the other helpers' reply drafts stay after the first answer is sent.
- A draft request's expiry and closing send no event.
- The runner's agent command runs as your OS user and can read the runner's agent credential. Run an
  agent command you do not trust under a separate user or in a container.
- The mod's guard is a pattern check on each tool call's text, not a sandbox.
- Nothing syncs with the identity provider (no SCIM): deactivate a leaver by hand. Blocking only the
  company account leaves issued credentials working until they expire (30 days for a session, 90 for
  an agent credential, by default).

[0.1.0]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0
