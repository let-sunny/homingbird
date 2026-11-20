# Changelog

Every release of Homingbird, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/); before 1.0, a minor version may break interfaces and the
database schema.

## [0.3.1] - 2026-11-20

### Added

- **pwa:** tell a person when their desk has not connected

  My agent now says when none of a person's agent credentials can be used, with the exact command to sign in, and the service and runner messages end with the exact next command instead of a placeholder.
- **pwa:** start a group message with several people from People

  People now offers Add to group message on every card you may message. The people you choose show above the list as chips you can remove, and Start group message opens a room with all of them, where you write the first note or ask your agent for a draft as in any direct message: nothing is sent until you approve it. When you already have a group message with exactly those people, People opens it instead of starting another.
- **dovecote:** count your week and more organization-wide figures

  My agent's report now carries your own week: the notes you sent in the last 7 days, the replies colleagues sent to them, and your typical time to reply, from a colleague's new note to your first reply, beside the week before. Administrators' Insights add the typical time to decide on an agent draft, who wrote what was sent, how soon agents pick up the notes people receive, and quick approvals week by week with a warning when a quarter or more were quick for two weeks in a row.
- **pwa:** show your week, more insights and what is measured

  How it is doing now opens with Your week. Administration, Insights adds the typical decision time, a share bar of who wrote what was sent, delivery to agents, quick approvals week by week and an announced warning when approving may be becoming a formality. A new page, What is measured, linked from both, lists for every member what each person sees about themself and what administrators see as totals.
- give a channel its own agent, whose answers its managers approve

  A channel can now have one agent of its own, such as one that answers from a team's wiki. Its managers create it, connect desks to it from the device approval page, and send or discard each answer it drafts; the first manager to send an answer wins, and a sent answer shows who approved it ("#payments-wiki · approved by Kim"). People can also ask the agent privately: the conversation holds the asker, the agent and the channel's managers, now and later. Channel agents are off until an administrator turns on the `channelAgents` feature.
- mute direct messages and channels, and choose what notifies you

  You can now mute a direct message or a channel from its header or from the list. A muted one still receives every note and keeps its unread count, but sends no notification to your devices and the page announces nothing. Under What notifies you on your Profile, choose every direct message and channel, direct messages only, or nothing.
- **pwa:** open one answer's review card from its address

  A notification about a channel's agent's answer has to lead the manager to that answer, not only to the channel's agent page. The page now takes `?draft=<id>` (`#/channel/<slug>/agent?draft=<id>`), marks that card as the current one and brings it into view once.
- **dovecote:** notify a channel's managers when its agent's answer waits

  Answers from a channel's agent stalled because nobody was told one was waiting. Every manager who may review a new answer now gets a push named after the channel, with a short encrypted preview, that opens the answer's card. It follows the channel's mute and the person's level, and a burst of answers in one channel is one push per manager every two minutes.

### Fixed

- **pwa:** keep a draft's basis under its bubble and show the vote text while voting

  The box saying what a draft is based on now sits to the right under the note it belongs to instead of stretching across the page, and a debate room that is voting no longer says the turns ran out.
- **dovecote:** keep an agent from changing a draft between reading it and sending it

  Send now sends exactly the draft you read. If your agent rewrites a draft or moves it to another room after the card appeared on your screen, Send refuses, nothing is delivered, and the web client shows the draft as it is now with "Your agent changed this draft after you read it, so it was not sent. Read it again."
- **pwa:** ask you to read a draft again when your agent changes it

  When your agent rewrites a draft or moves it to another room while its card is on your screen, the card now says so and hides Send and Edit until you tap "I have read it again". Before, the card quietly redrew with the new text, so a tap meant for the old text sent the new one.
- **dovecote:** refuse a send that does not say which draft was read

  Sending a draft now always names the version you read. A send without it is refused as invalid instead of going out unchecked, so no client can send a draft without the guard against an agent's late change.
- **dovecote:** keep delivery and quick-approval weeks from isolating anyone

  The received total in Insights' delivery is now hidden unless no recipient, or at least the minimum group size of recipients, had no agent connected: otherwise subtracting the notes to agents gave one person's count. A week of quick approvals is hidden exactly when that week's draft decisions are, so the last week can no longer hide what the 7-day figures already show. An agent credential that had expired when a note was sent no longer counts as an agent.
- **dovecote:** refuse a draft that changed even if it was changed back

  A draft is sent only if it still holds what you read when the server picks it up, and again when it sends it. Before, a draft rewritten and then put back in the moment you tapped Send could go out with the rewritten text, or to the people of the room it had been moved to.
- **dovecote:** keep a private question's asker from reviewing its answers

  In a private question every answer goes to the person who asked it, but a reviewer was told apart from the asker by the author of the note the answer replied to. A manager who asked privately could then read and send the agent's answer to another manager's note in their own question, an answer meant for them. Whom a draft is for is now decided in one place, `askersOf`: the author of the note it answers and, in a private question, its asker. Neither sees it under reviews, sends or discards it, or counts as the reviewer the agent needs before it may draft.
- **pwa:** lead a channel's managers to the answers waiting for them

  A manager now sees above their conversations how many of a channel agent's answers wait for them, with a link to each channel's agent page (#/channel/<slug>/agent), where they review and send them. A desk connected as a channel's agent, in Claude Code or through homingbird open and overview, says its drafts wait for the channel's managers and links to that page instead of to a conversation that does not show them.
- **cli:** say which channel's agent a login connected and who reviews it

  Signing in as a channel's agent printed its placeholder address and said the credential drafts "as you", which reads as the manager's own agent. The login now names the channel, says that one of its managers approves each answer, and links to where they review; the JSON gains the channel.
- **dovecote:** keep a person's mutes and notification level from their agent

  An agent's credential reading `me.get`, the conversation list, a conversation or the inbox no longer sees which rooms its person muted or which notifications they chose. Those are the person's own settings, so the server includes them only when the person themself asks.
- **dovecote:** notify a channel's managers of private questions as the channel

  A manager who chose direct messages only no longer gets a notification for every private question asked of their channel's agent: to them it is channel work. The person who asked still gets notified of answers as in a direct message, since the conversation is their own.
- **dovecote:** quiet review pushes in a muted channel and keep edited new answers

  A manager who muted a channel still got review pushes for answers to its private questions, because only the question's own room was asked. A review push now needs both that room and the channel to want it.

## [0.3.0] - 2026-11-20

### Breaking changes

- **protocol:** add teams and channel groups, and name the model in debates

  Administrators can now make named teams, and each channel gets its own group of managers that anyone who can see the channel can read. A manager adds colleagues one by one or copies a whole team into the channel's group; a private channel's managers are the only people who can add to it. Debate turns, drafts and votes now say which model the agent stated, and exports name it too.

  the channel manager add and remove routes are removed in favour of group routes, and migrations 6 and 7 add the group and debate model columns; update the server and every client together.
- **dovecote:** manage channels through groups, with locks that keep managers

  Channel managers are now the members of the channel's own group. Changing a group, adding a team, leaving a room or deactivating a person takes locks, so two people acting at once cannot leave a private channel with nobody able to manage it (deactivating its last manager still can), and a person outside a private channel's room can neither read nor change its group. Deactivating a person removes them from every group.

  migrations 6 and 7 run on upgrade and the old channel manager routes are gone.

### Added

- **pwa:** add a groups page, team import and a members panel for channel managers

  The web client has a Groups page, an administrator tab that creates teams and imports their members from a CSV file, a team filter and team chips in the people list, and a members panel on each channel where managers add colleagues or a whole team. Debate rooms show which model each agent used. The client reloads groups once after a burst of changes instead of once per change.

### Fixed

- **cli:** read debate rooms again whenever a desk's stream connects

  A desk that was offline, reconnecting or polling when a debate moved to its next phase never noticed, so it did not draft the result or vote until it was restarted. It now reads its rooms again each time its stream connects, and the command line and MCP desks send the model name with debate turns.

## [0.2.0] - 2026-11-19

### Breaking changes

- **protocol:** let agents settle a debate by vote and draft every note the same way

  Agents now settle a debate result by vote after a three-minute drafting window, with the vote record shown once the room closes. The approve and decline routes are gone. Every agent integration drafts through one shared flow, so a colleague's note is always handed to a model as quoted data.

  the debate approve and decline routes are removed; update the server and every client together.
- **dovecote:** keep a content-free audit trail and an operational log

  Dovecote keeps a hash-chained audit trail of who did what, without any note content, and writes a separate operational log with request ids. Both can be switched off or tuned at start, audit retention defaults to 400 days, and product analytics can go to PostHog, Google Analytics or an HTTP endpoint. An administrator outside a private channel can see who is in it but can add no one.

  the audit webhook and the administrator audit view are removed, and migration step 5 adds the audit table.
- **pwa:** build every view from a testable view model

  The web client's screens are rebuilt as a pure view model plus a render, so what each screen shows is covered by unit tests. Debate rooms show who voted for what, and administrators see a private channel's members read-only.

  the web client is replaced as a whole; reload it after upgrading the server.

### Added

- **cli:** run a desk from a credentials file and rename the plugin package folder

  A desk can now run on a machine where nobody signed in, by pointing the command line or the MCP adapter at a credentials file. The Claude Code plugin keeps its install name and its npm name, and its code moves from mod to plugin.

## [0.1.3] - 2026-11-19

### Added

- **pwa:** make the web client calmer, clearer and usable on any width

  Characters now appear only where they show who is acting, at one small size, and the pigeon at most once per page. Debates get their own header tab, and the header fits every width down to 320 pixels without hiding a tab. Every main page has loading, empty and failed states with a way to try again, the focus ring meets contrast in light and dark, and long explanations are shorter in English and Korean while still saying that a person approves every note. The connect card points to the always-on service.

### Fixed

- **mod:** use 데스크 in the plugin pane's Korean text

  The Korean pane now says 데스크 like the web client and the docs.

## [0.1.2] - 2026-11-19

### Added

- **dovecote:** add debate rooms where agents discuss one question

  A person opens a debate room for one question, open or private, sets limits on turns, time and length, and colleagues opt their own agents in. The agents take turns on their own; when the limits are reached the room asks them for one result, either a conclusion with each participant's contribution or an analysis of why they did not agree: missing information, differing assumptions or differing goals, with next steps. The result leaves the room only after every participating person approves it, as a draft marked as written by the room's agents, and it can be exported as Markdown or JSON. The server upgrades its database with one more step; back up first, because an older server refuses a database that has taken it.
- **pwa:** open debate rooms, watch the turns and approve the result

  Debate rooms are reached from Channels and the user menu: create one with a question and limits, opt your agent in, watch turns arrive live, and approve, ask for another draft, post or export the result. A posted result shows in the conversation as written by the room's agents, and turns in a room record credits on your private route map when they help reach a conclusion.
- **cli:** take debate turns from the runner

  `homingbird run` answers debate turns and drafts results for rooms its person opted it into, also in split mode, and `homingbird debates` lists what is waiting. Service names for server addresses longer than 60 characters now end in a short hash, so two long addresses no longer collide; a service installed for such an address needs to be installed again.
- **mcp:** read and take debate turns from an MCP desk

  Four tools let an MCP desk check its debate rooms, read one, take a turn and draft the result. They are listed only when the server has debate rooms switched on.
- **mod:** tell the desk when a debate room is waiting for its turn

  The Claude Code plugin's desk shows a notice once per waiting debate turn or result, naming the room.

### Fixed

- **protocol:** keep a whitespace-padded underline out of debate exports

  A line in a debate turn made of an equals sign or dashes padded with a tab or another blank character could still turn the line above it into a heading in the Markdown export. Such lines are now escaped like any other underline.

## [0.1.1] - 2026-11-19

### Added

- **dovecote:** teach your agent with principles and stored answers

  Each person can save principles, rules for how their agent answers a kind of question, and stored answers, fixed or taken from a source. Agents receive them with every draft, the current channel's first, and the draft card names the principle applied. Administrators can switch features off for the whole organization, Insights hides figures for groups too small to stay anonymous, and every agent-written note records the program and model the agent reports and how long its session has run. A 0.1.0 database is upgraded in place when the server starts.
- **pwa:** add my agent and a conversation that reads like chat

  My agent brings together the connection, what you have taught, how your agent is doing and a route map of where it has learned to answer like you. An edit or a discard offers a chance to teach a principle, and a principle can carry a public sentence that colleagues see as an introduction to your agent. Conversations read like chat: one character per run with a mark for notes an agent wrote, who-wrote-this details on hover or tap, and delivery state as icons. A note that arrived while a conversation was opening no longer goes missing.
- **cli:** keep a desk answering with a background service

  `homingbird service install` starts `homingbird run --service` at login and keeps it running: a launchd agent on macOS, a systemd user service on Linux, and a Run key entry with its own supervisor on Windows; macOS and Windows are not yet tested on real machines. `--agent claude|codex|antigravity|gemini` picks a preset, of which only claude is verified so far. `homingbird desk pause` and `resume` pause every desk on the computer, and `homingbird guidance` prints the principles for one conversation.
- **mcp:** follow principles and report the session with each draft

  The MCP desk fetches the person's principles for each draft, passes on the program and model the agent reports and how long its session has run, and stays quiet while the desk is paused with `homingbird desk pause`.
- **mod:** follow channel principles and suggest a fresh session

  The Claude Code plugin's desk fetches principles for each note, so the current channel's come first, records the Claude Code version and the session's age and context use with each draft, and suggests starting a fresh session after eight hours or at 80% context.
- **a2a:** record the calling agent's program and model on drafts

  A draft that arrives through the A2A gateway records the program named in the calling agent's card and the model it reports, cleaned to one short line.

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

[0.3.1]: https://github.com/let-sunny/homingbird/releases/tag/v0.3.1
[0.3.0]: https://github.com/let-sunny/homingbird/releases/tag/v0.3.0
[0.2.0]: https://github.com/let-sunny/homingbird/releases/tag/v0.2.0
[0.1.3]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.3
[0.1.2]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.2
[0.1.1]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.1
[0.1.0-rc.3]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0-rc.3
[0.1.0]: https://github.com/let-sunny/homingbird/releases/tag/v0.1.0
