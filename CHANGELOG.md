# Changelog

Every release of Homingbird, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/); before 1.0, a minor version may break interfaces and the
database schema.

## [0.1.0] - 2026-11-18

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
- **Web client.** Dependency-free and installable on a phone: direct messages, channels, People with
  presence in words, and writing by hand. Approval happens here and nowhere else: every draft has
  **Send**, **Edit** and **Discard**, and the card of the person who approves shows what the draft is
  based on. Phone notifications come through Web Push, with **Send a test notification** to check
  each device, and one `theme.css` restyles the client (`HB_THEME_DIR`).
- **Agents.** Two desks are equally supported: the runner, `homingbird run --agent "<command>"`, for
  any agent that runs from a command, such as `codex exec` or `gemini -p`, and the Claude Code mod for
  people who already work in Claude Code.
  - Claude Code mod: `/homingbird` opens a desk pane with direct messages, channels, notes waiting
    for a reply and drafts waiting for approval, and keeps one desk among sessions. Each waiting draft
    opens in the web client, where the person approves it; the pane and the model cannot approve. It
    brings its own copy of the command line, needs Claude Code 2.1.327 or newer, finds Node 22 or
    newer where nvm, Volta, asdf, fnm or Homebrew put it, asks for the server address at install, and
    signs a person in from the pane with a code and a button.
  - MCP adapter: a stdio server (`--desk` for the one session that answers what arrives), a `watch`
    prompt for clients whose chat stays open, and the same tools at `/mcp` for web connectors.
  - Command line: reading, drafting and streaming, and the desk runner.
  - Each server you sign in to keeps its own agent credential on your computer; signing in or out of
    one never changes another.
  - A2A gateway (experimental): a remote agent's message becomes a draft; tasks show its state and
    the replies.
  - Every note an agent picks up ends in a draft, a holding reply when it cannot answer yet, or a skip
    whose reason only its person sees (`skip_note`, `homingbird skip`). What an agent read or relied
    on for a draft is shown to the person who approves it, the draft's author, and kept in the audit
    log; recipients never see it. Agents may read what a colleague links to with their person's own
    tools, and only read.
  - An administrator can set one answering flow for the server: steps before drafting and checks on
    the draft, written by purpose, that every member's desk follows. Homingbird runs the chain; the
    organization supplies the steps.
- **Channels.** Ask a channel when you do not know who can answer. Joining a channel and answering in
  it are separate switches; the first approved reply answers the question. A channel is open or
  private; managers add and remove the members of a private channel. Only the channels in
  `HB_CHANNELS` and the ones people create exist, and nobody is put in one automatically. When no
  channel fits, the agent drafts to a colleague whose profile or channels match, or tells its human
  that it found no one. The channel list puts the channels you are in first, then the fullest, and
  pages; an archived channel leaves a room its people can still read.
- **Draft requests.** Ask your agent for a draft from the web client; your desk picks the request up.
  A request expires after 24 hours.
- **Profile characters.** 24 built-in pixel characters and an editor to make your own, which an
  agent can draft and check; only a person's click saves one, and the server validates it again.
- **Languages.** English and Korean, chosen per person, for the web client, phone notifications and
  the mod's pane.
- **Administration.** Administrators manage members, channels and settings in the web client.
  Deactivating a member revokes all of their sessions and agent credentials at once, hides them from
  People and refuses their sign-in.
- **Audit.** Every action is audited, note content included, with forwarding to standard output or
  a webhook and an optional retention period.
- **Databases.** SQLite built into Node, PostgreSQL, and MySQL 8 (experimental). The 0.1.0 schema is
  the baseline, created on first start.
- **Theming.** `HB_THEME_DIR` restyles the client with `theme.css` and `branding.json`, and serves the
  theme's own fonts and images under `/theme/`.
- **Deployment.** The image `ghcr.io/let-sunny/homingbird`, tagged per version; a Compose file; and
  Terraform for GCP and AWS (experimental), which passes `terraform validate` in CI and has not been
  applied.

Experimental: tested automatically, not yet used in a real deployment.

### Security

Seven rules, each with a block of tests in `packages/dovecote/test/security-rules.test.ts`:

1. Only a human credential can approve a note.
2. Drafts are invisible to recipients.
3. No tool exposed to a model can approve, change contacts, or read credentials. No agent integration
   can approve: approval happens only in a client where the person signed in themself, the web client.
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
  long-poll until it restarts, and a long-polling agent does not count as awake.
- The server does not enforce one desk: `homingbird-mcp --desk`, `homingbird-mcp --channel` and
  `homingbird run` each draft their own reply to the same note.
- A note in a channel room writes one event row per participant of that room.
- In a channel room, the other answerers' reply drafts stay after the first answer is sent.
- A draft request's expiry and closing send no event.
- On a computer, Web Push notifications arrive only while the browser is running; keep it running
  in the background to receive them with every window closed.
- The runner's agent command runs as your OS user and can read the runner's agent credential. Run an
  agent command you do not trust under a separate user or in a container.
- The mod's guard is a pattern check on each tool call's text: a courtesy, not a boundary. It does not
  need to be one, because no credential that can approve is ever on the agent's machine.
- Nothing syncs with the identity provider (no SCIM): deactivate a leaver by hand. Blocking only the
  company account leaves issued credentials working until they expire (30 days for a session, 90 for
  an agent credential, by default).

### Changes

Since 0.1.0-rc.2:

- There is no built-in `general` channel: the server creates exactly the channels in `HB_CHANNELS` and puts nobody in one. When no channel fits, an agent asks a matching colleague or tells its person.
- The database schema is one 0.1.0 baseline. Dovecote refuses to start on a database a release candidate made: recreate it from an empty database.
- An administrator can set one answering flow for the server: steps before drafting and checks on each draft, written by purpose, that every member's desk follows.
- An agent ends every note it picked up in a draft or a skip with a reason only its person sees, so a note never stays "drafting reply".
- The web client has a guided tour and clearer channels, refusals and dark mode.
- The Claude Code mod asks for the server address at install, finds Node 22 where version managers put it, and signs in from its pane.

Approval is no longer available in the Claude Code mod: approve, edit and discard drafts in the web client, where you sign in yourself.

- The mod's pane shows each draft as "Waiting for your approval" with "Open in web", which opens its conversation in the web client. The pane no longer approves, edits or discards, and the approval credential it used is gone, together with the server setting, the `server.info` field and the device page checkbox that offered it. A credential that could approve, stored on the computer where the agent runs as the same user, could not be protected by the mod's pattern guard.
- The command line drops `homingbird approve`, `homingbird discard` and the login option that stored an approval credential; it stores an agent credential only. A device or OAuth sign-in issues nothing else, and Dovecote accepts a person's credential only from a browser sign-in, so approval credentials issued by 0.1.0-rc.3 stop working. An old `approval-credential.json` can be deleted.
- The person who approves sees what the draft is based on: the web client shows the agent's basis on the draft card, and says so when there is none. Only the draft's author ever receives it.
- "Your agent did not draft a reply" and a draft discarded because its channel was archived now survive a reload and show on every device.
- Administrators archive a channel with one action, "Archive channel", optionally moving its members to another channel; it replaces the two rc.3 actions and routes that removed a room or folded it into another (`admin.channels.archive` is the one route now).
- Agents show as "awake" rather than "online": connected is not the same as running.
- Sign-in checks the identity provider's discovery document: its issuer must equal `HB_OIDC_ISSUER`, its endpoints must be public https hosts, and discovery, keys and the token call refuse redirects. An ID token issued in the future, or not valid yet, is refused.
- After signing out and in again in one Claude Code session, the desk starts a fresh live stream for the new credential.
- The plugin marketplace now pins the exact mod version, so it installs the version the repository names instead of npm's `latest`.
- The A2A gateway, the Terraform configurations and MySQL support are marked experimental: tested automatically, not yet used in a real deployment.

Breaking: the rc.3 question rooms are now **channels** and one-to-one conversations **direct messages**, everywhere. Routes are `channels.*` and `admin.channels.*` under `/channels`, the conversation kinds are `channel` and `direct`, events are `channel.changed` and `channel.left`, drafts take `channel`, MCP and mod tools are renamed (for example `find_channels`), the command line takes `--channel` and `homingbird channels`, and the list of channels is set with `HB_CHANNELS`, which replaces the rc.3 `HB_TOPICS` (Dovecote refuses to start while `HB_TOPICS` is still set). Each channel explains itself in one sentence: ask there and the people who answer in it reply; every note is approved by a person first.

Also fixed after the rc.3 live test:

- Each server keeps its own agent credential (`~/.config/homingbird/agents/`, one private file per server address); the old shared `agent-credential.json` is ignored and removed at the next sign-in. Every command takes `--server` (or `HOMINGBIRD_SERVER`); without one it uses the only server signed in to and lists them when there are several. `logout` signs out of one server only, and `status` lists every server.
- The mod is bound to one server: every command it runs names it, it never shows another server's identity, the desk stops and says so when the account or server changes, and the pane has **Sign out**.
- The mod declares Claude Code 2.1.327 or newer; on an older Claude Code the pane still loads and says to update.
- Push notifications: a person counts as looking only while a Homingbird page is visible, so a minimised window or background tab gets notified; each push attempt is logged (member, push service host, answer); **Send a test notification** in the profile shows what each push service answered; the VAPID subject is an https address or a `mailto:`, never a plain http address; turning notifications on twice reuses the subscription.
- Development login without `HB_ALLOWED_DOMAINS` accepts any address, with a warning at start; the docs show a minimal local command bound to `127.0.0.1`.
- "Newer notes below" appears only for something unseen below and never covers a draft; the tour's callouts sit beside their controls; a conversation opened right after sign-in shows its notes.

A database created by 0.1.0-rc.3 does not keep working: the 0.1.0 baseline schema changed in place (still version 1). Start Dovecote with an empty database.

Fixes from the live retest.

- In a narrow header, the connection badge no longer shows as a bare square. Connected, it is hidden and stays readable to assistive technology; connecting and offline always show their word.
- A tour step for a header control sits under that control with its usual width, instead of stretching across the page.
- A channel's address is now `#/channel/<name>`; old `#/t/<name>` links still open it.
- Archiving a channel stops showing an agent as drafting in it, and an agent that tries to reply there is told that no reply is possible because the channel was archived.
- With development login and no `HB_ADMIN_EMAILS`, the startup warning says that the first member to sign in becomes an administrator.

## [0.1.0-rc.3] - 2026-11-18

### Changes

Since 0.1.0-rc.2:

- There is no built-in `general` topic: the server creates exactly the topics in `HB_TOPICS` and puts nobody in one. When no topic fits, an agent asks a matching colleague or tells its person.
- The database schema is one 0.1.0 baseline. Dovecote refuses to start on a database a release candidate made: recreate it from an empty database.
- An administrator can set one answering flow for the server: steps before drafting and checks on each draft, written by purpose, that every member's desk follows.
- An agent ends every note it picked up in a draft or a skip with a reason only its person sees, so a note never stays "drafting reply".
- The web client has a guided tour and clearer topics, refusals and dark mode.
- The Claude Code mod asks for the server address at install, finds Node 22 where version managers put it, and signs in from its pane.

[0.1.0-rc.3]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0-rc.3
[0.1.0]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0
