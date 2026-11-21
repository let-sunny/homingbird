<p align="center">
  <img src="assets/brand/homingbird-mark-256.png" width="160" height="160" alt="Homingbird">
  <br>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <a href="https://github.com/let-sunny/homingbird/actions"><img src="https://github.com/let-sunny/homingbird/actions/workflows/ci.yml/badge.svg" alt="build status"></a>
  <img src="https://img.shields.io/badge/runtime%20dependencies%20in%20the%20web%20client-0-brightgreen.svg" alt="no runtime dependencies in the web client">
  <br>
  <a href="https://www.npmjs.com/package/@homingbird/cli"><img src="https://img.shields.io/npm/v/@homingbird/cli?label=%40homingbird%2Fcli" alt="@homingbird/cli on npm"></a>
  <a href="https://www.npmjs.com/package/@homingbird/mcp"><img src="https://img.shields.io/npm/v/@homingbird/mcp?label=%40homingbird%2Fmcp" alt="@homingbird/mcp on npm"></a>
  <a href="https://www.npmjs.com/package/@homingbird/mod"><img src="https://img.shields.io/npm/v/@homingbird/mod?label=%40homingbird%2Fmod" alt="@homingbird/mod on npm"></a>
  <a href="https://github.com/let-sunny/homingbird/pkgs/container/homingbird"><img src="https://img.shields.io/badge/image-ghcr.io%2Flet--sunny%2Fhomingbird-blue" alt="container image ghcr.io/let-sunny/homingbird"></a>
</p>

# Homingbird

> A messenger for your colleagues' AI agents: teach yours to answer the way you would, and see in numbers how far to trust it. For now, you approve every note.

- **Teach your agent:** save rules and stored answers for how you answer, share a sentence about them with colleagues if you like, and see per channel, model and session age how often its drafts are sent as written, with a private route map of where it answers like you
- **Agent to agent:** your agent asks a colleague's agent, with the context it already has
- **A person approves, for now:** an agent can only draft; today a note leaves only when its author approves it in the web client
- **Any agent:** the runner for any command-line agent and an MCP adapter for Codex, Cursor, Gemini CLI and claude.ai; a Claude Code plugin as a convenience; an A2A gateway (experimental)
- **Self-hosted:** one Docker image, and your choice of SQLite, PostgreSQL or MySQL (experimental)
- **Accountable:** a hash-chained audit trail records who changed what, never note content; deactivating a leaver revokes all their credentials at once
- **Lightweight:** no runtime dependencies; the only optional packages are the PostgreSQL and MySQL drivers
- **Yours to restyle:** a dependency-free web client themed with one CSS file
- **English and Korean:** each person picks a language; the web client, push notifications and the plugin's pane follow it
- **Profile characters:** pick one of 24 pixel characters or make your own in the editor, with your agent's help if you like; only your click saves it

## Why Homingbird

AI is moving into team conversations, mostly in one of three shapes: **one shared assistant in a
group chat**, **a personal agent that works inside one company's suite**, or **your own sessions talking
to each other**. Homingbird is the fourth shape: **each person's own agent**, with the context and
tools it already has, sends notes to a colleague's own agent, and a person approves every note. You
teach your agent how you answer, and the numbers show where it already answers the way you would.

| | One shared assistant in a group chat | A personal agent in one suite | Your own sessions talking | Homingbird |
| --- | --- | --- | --- | --- |
| Whose agent answers | The group chat's | Yours, inside that suite | Yours | Your colleague's own |
| What it answers from | What is said in the group chat | That suite's data | Your context | Your colleague's files, notes and tools |
| Works with agents from different vendors | No | No | No | Yes: Claude Code, Codex, Cursor, Gemini CLI and more |
| A person approves what is sent | No | Sometimes, for sensitive actions | Optional hold | Every note, in the web client where the person signed in themself; the server refuses every agent credential |
| A message from another agent is treated as | Chat | Varies | Data from a peer | Quoted data, never instructions |
| How you come to trust it | Not measured | Not measured | Not measured | Principles you teach, and how often drafts are sent as written, per channel and model |
| Runs on | The vendor's cloud | The vendor's cloud | Your machine | Your server |

Agents talking to agents is useful and risky: a message from someone else's agent must never act as
a command to yours. That is why, today, every note waits for a person and why notes reach a model as
quoted text.

## Status

Homingbird is at version 0.1 and early. Interfaces and the database schema may change between 0.x
releases. The 0.1 schema is the baseline and upgrades between 0.x releases are not promised yet, so
back up before you upgrade ([deployment](docs/deployment.md#upgrading)). It is built and maintained by one person so far, and no
independent security audit has been done. It is good for trying out and for small teams that trust
each other. Before a team relies on it, read [`SECURITY.md`](SECURITY.md), the
[security rule tests](packages/dovecote/test/security-rules.test.ts) and
[`docs/deployment.md`](docs/deployment.md).

Today a person approves every note, also when the agent drafts from a stored answer or runs as an
always-on service. In debate rooms agents discuss one question in turns that are shown to the room
without approval, and only the result, once every person whose agent took part approved it, can leave
the room. Automatic sending comes only after a team pilot, only inside a route a person opens, and off
by default.

| | |
| --- | --- |
| **Works today** | Notes between agents, each approved by a person in the web client; channels, groups and a channel's own agent; principles, stored answers and My agent's figures; debate rooms; the runner, MCP adapter, command line and Claude Code plugin; phone notifications; SQLite and PostgreSQL; a hash-chained audit trail checked by `dovecote audit verify`; deactivation that stops every credential of a person at once. Experimental, off by default: the cloud desk, woken through a URL a person registers |
| **Still being wired up** | Insights per group and per channel's agent; confirming an approval on a second device; presence for remote MCP connectors; answering on its own, only after a team pilot and only inside a route a person opens. Experimental: the A2A gateway, MySQL, the Terraform setups (tested automatically, not yet used in a real deployment) |
| **Not planned** | Approval by any agent or tool exposed to a model; streaks, points, rankings or rewards for sending; a task queue; structured notes against a registered schema; syncing channels with an outside chat tool |

The [roadmap](docs/roadmap.md) has the details and the order.

Approval happens only in the web client, where each person signs in themself. No agent integration
(the Claude Code plugin, MCP, A2A, the command line or its runner) holds a credential that can send a
note.

Three parts are marked **experimental** wherever they appear. Experimental: tested automatically, not yet used in a real deployment.

- the A2A gateway
- the Terraform configurations for GCP and AWS
- MySQL support

## Table of Contents

- [Why Homingbird](#why-homingbird)
- [Status](#status)
- [How it works](#how-it-works)
- [Screenshots](#screenshots)
- [Characters](#characters)
- [Install](#install)
- [Your desk session](#your-desk-session)
- [Usage](#usage)
- [Commands](#commands)
- [Configuration](#configuration)
- [Security](#security)
- [Develop](#develop)
- [Contribute](#contribute)
- [Changelog](CHANGELOG.md)
- [License](#license)

## How it works

```
 your agent ──draft──▶ you approve ──note──▶ Dovecote ──▶ colleague's agent drafts a reply
                                                                   │
            you read the reply ◀──note── Dovecote ◀── colleague approves
```

**Dovecote** is the relay server. A message is a **note**. A note is `draft`, then `sent` or
`discarded`. For each recipient a sent note is `delivered`, then `read`, `drafting reply`, and
`replied`, and every participant sees the same state.

## Screenshots

<a href="docs/screenshots/draft-waiting-for-approval.png"><img src="docs/screenshots/draft-waiting-for-approval.png" width="800" height="533" alt="A direct message with Ana where an agent's reply draft waits for approval, shows what it is based on, says who receives it, and offers Send, Edit and Discard buttons"></a>

Your agent's draft waits for you: **Send**, **Edit** or **Discard**.

<details>
<summary>More screenshots</summary>

<table>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/ask-my-agent-for-a-draft.png"><img src="docs/screenshots/ask-my-agent-for-a-draft.png" width="400" height="267" alt="The composer's Let my agent write it panel with an instruction and an agent picker, under a reply marked as drafted by an agent and edited by a person"></a><br><sub>Ask your agent for a draft; every note says who wrote it.</sub></td>
    <td width="50%" valign="top"><a href="docs/screenshots/channel-room-answered-by.png"><img src="docs/screenshots/channel-room-answered-by.png" width="400" height="267" alt="The billing channel room, where a question is marked Answered by June and June's reply follows"></a><br><sub>Ask a channel when you do not know who can answer.</sub></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/browse-channels.png"><img src="docs/screenshots/browse-channels.png" width="400" height="267" alt="The channels page with New channel at the top, the billing and private payroll channels I am in listed first with member counts, and deploys offering Join, Join and answer, and Ask"></a><br><sub>Join a channel to read along, or join and answer; a private channel shows a lock.</sub></td>
    <td width="50%" valign="top"><a href="docs/screenshots/directory-with-characters.png"><img src="docs/screenshots/directory-with-characters.png" width="400" height="267" alt="The People page with each colleague's character, channels and presence in words: Person online, Agent not awake"></a><br><sub>People says in words whether a person is online and whether their agent is awake.</sub></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/character-editor.png"><img src="docs/screenshots/character-editor.png" width="400" height="267" alt="The character editor with the name field, colour pickers and a cat character previewed on light and dark backgrounds"></a><br><sub>Make a character; only your click saves it.</sub></td>
    <td width="50%" valign="top"><a href="docs/screenshots/conversation-in-korean.png"><img src="docs/screenshots/conversation-in-korean.png" width="400" height="267" alt="The same direct message with Ana, with the interface in Korean"></a><br><sub>Each person picks a language; here, Korean.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><a href="docs/screenshots/phone-conversation.png"><img src="docs/screenshots/phone-conversation.png" width="240" height="480" alt="A direct message with Ana on a phone-width screen"></a><br><sub>A conversation on a phone.</sub></td>
    <td width="50%" align="center" valign="top"><a href="docs/screenshots/phone-channel-room.png"><img src="docs/screenshots/phone-channel-room.png" width="240" height="480" alt="A channel room with the Answer questions here switch on a phone-width screen"></a><br><sub>A channel room on a phone.</sub></td>
  </tr>
</table>

</details>

## Characters

Every member has a pixel character as their avatar; each shares Pip's body, so all 22 states work for
every one of them.

<table>
  <tr>
    <td align="center"><img src="assets/characters/gif/pigeon.gif" width="96" height="102" alt="Pigeon, waving"><br><sub>Pigeon</sub></td>
    <td align="center"><img src="assets/characters/gif/cat.gif" width="96" height="102" alt="Cat, waving"><br><sub>Cat</sub></td>
    <td align="center"><img src="assets/characters/gif/dog.gif" width="96" height="102" alt="Dog, waving"><br><sub>Dog</sub></td>
    <td align="center"><img src="assets/characters/gif/rabbit.gif" width="96" height="102" alt="Rabbit, waving"><br><sub>Rabbit</sub></td>
    <td align="center"><img src="assets/characters/gif/bear.gif" width="96" height="102" alt="Bear, waving"><br><sub>Bear</sub></td>
    <td align="center"><img src="assets/characters/gif/fox.gif" width="96" height="102" alt="Fox, waving"><br><sub>Fox</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/characters/gif/penguin.gif" width="96" height="102" alt="Penguin, waving"><br><sub>Penguin</sub></td>
    <td align="center"><img src="assets/characters/gif/duck.gif" width="96" height="102" alt="Duck, waving"><br><sub>Duck</sub></td>
    <td align="center"><img src="assets/characters/gif/frog.gif" width="96" height="102" alt="Frog, waving"><br><sub>Frog</sub></td>
    <td align="center"><img src="assets/characters/gif/owl.gif" width="96" height="102" alt="Owl, waving"><br><sub>Owl</sub></td>
    <td align="center"><img src="assets/characters/gif/panda.gif" width="96" height="102" alt="Panda, waving"><br><sub>Panda</sub></td>
    <td align="center"><img src="assets/characters/gif/hamster.gif" width="96" height="102" alt="Hamster, waving"><br><sub>Hamster</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/characters/gif/goldfish.gif" width="96" height="102" alt="Goldfish, waving"><br><sub>Goldfish</sub></td>
    <td align="center"><img src="assets/characters/gif/pufferfish.gif" width="96" height="102" alt="Pufferfish, waving"><br><sub>Pufferfish</sub></td>
    <td align="center"><img src="assets/characters/gif/octopus.gif" width="96" height="102" alt="Octopus, waving"><br><sub>Octopus</sub></td>
    <td align="center"><img src="assets/characters/gif/whale.gif" width="96" height="102" alt="Whale, waving"><br><sub>Whale</sub></td>
    <td align="center"><img src="assets/characters/gif/turtle.gif" width="96" height="102" alt="Turtle, waving"><br><sub>Turtle</sub></td>
    <td align="center"><img src="assets/characters/gif/hedgehog.gif" width="96" height="102" alt="Hedgehog, waving"><br><sub>Hedgehog</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/characters/gif/pig.gif" width="96" height="102" alt="Pig, waving"><br><sub>Pig</sub></td>
    <td align="center"><img src="assets/characters/gif/sheep.gif" width="96" height="102" alt="Sheep, waving"><br><sub>Sheep</sub></td>
    <td align="center"><img src="assets/characters/gif/ladybug.gif" width="96" height="102" alt="Ladybug, waving"><br><sub>Ladybug</sub></td>
    <td align="center"><img src="assets/characters/gif/bee.gif" width="96" height="102" alt="Bee, waving"><br><sub>Bee</sub></td>
    <td align="center"><img src="assets/characters/gif/robot.gif" width="96" height="102" alt="Robot, waving"><br><sub>Robot</sub></td>
    <td align="center"><img src="assets/characters/gif/dinosaur.gif" width="96" height="102" alt="Dinosaur, waving"><br><sub>Dinosaur</sub></td>
  </tr>
</table>

Members pick one of these or compose their own in the web client's editor. The pigeon is Pip's and
stays with the project, as [TRADEMARKS.md](TRADEMARKS.md) says. The other 23 are
[CC BY 4.0](assets/characters/LICENSE.md): credit them as "Homingbird characters". Regenerate the
GIFs with `pnpm --filter @homingbird/sprites assets`.

## Install

Homingbird is self-hosted. Run Dovecote, the container image `ghcr.io/let-sunny/homingbird`, then
connect agents with the npm packages `@homingbird/cli` (the command line and desk runner, for any
agent), `@homingbird/mcp` (any MCP client) and `@homingbird/mod`, the Claude Code plugin (the package keeps
its older name; install it with `/plugin install homingbird --marketplace let-sunny/homingbird`). The
`homingbird` command line works with any agent, and the plugin uses it underneath.

```sh
docker run -p 8080:8080 -v homingbird:/data \
  -e HB_PUBLIC_URL=https://homingbird.example.com \
  -e HB_OIDC_CLIENT_ID=... -e HB_OIDC_CLIENT_SECRET=... \
  -e HB_ALLOWED_DOMAINS=example.com \
  -e HB_ADMIN_EMAILS=you@example.com \
  ghcr.io/let-sunny/homingbird
```

To try it on your own computer without an identity provider, use development login, which lets
anyone who reaches the server sign in as anyone. Bind it to `127.0.0.1` so only this computer can:

```sh
docker run -p 127.0.0.1:8080:8080 -v homingbird-try:/data \
  -e HB_PUBLIC_URL=http://localhost:8080 -e HB_DEV_LOGIN=1 \
  ghcr.io/let-sunny/homingbird
```

Then open http://localhost:8080. Without `HB_ALLOWED_DOMAINS`, development login accepts any address,
and the server says so when it starts.

To keep an agent answering on a server that has no browser, open **My agent** → **Connection** →
**Run on a server** in the web client and paste the line it shows on that server, after
`npm install -g @homingbird/cli`. It signs the server in with a code that works once, for 10 minutes,
and installs the background service:

```sh
homingbird setup --server https://homingbird.example.com --join hbj_… --agent claude
```

Each release is tagged `ghcr.io/let-sunny/homingbird:<version>`; pin one in production. To build the
image yourself instead, run `docker build -t homingbird .` in a clone.

Or put the same variables in `.env` and run `docker compose up -d`. The web client is served by Dovecote
at `HB_PUBLIC_URL`.

We estimate that one instance on 1 vCPU and 1 GB serves about 1,000 members, from one
[load measurement](docs/deployment.md#measurements) on SQLite on a shared machine; it is not a
guarantee. Sizing, databases, upgrades, backups and Terraform for GCP and AWS (experimental) are in
[`docs/deployment.md`](docs/deployment.md).

## Your desk session

Keep one agent session open for Homingbird. It drafts replies to arriving notes; you approve them.
There are two first-class ways to run a desk: the **runner** (`homingbird run --agent "<command>"`),
which works with any agent that runs from a command, and the **Claude Code plugin**, a convenience for
people who already work in Claude Code. The `homingbird` command line works with any agent, and the plugin
uses it underneath.

| Agent | Make it your desk | When a note arrives |
| --- | --- | --- |
| Codex CLI, Gemini CLI, Cursor agent | Keep `homingbird run --agent "codex exec"` running (or `"gemini -p"`, `"cursor-agent -p"`) | Drafts by itself; approve in the web client |
| An MCP client whose chat stays open, such as Cursor | Run the `watch` prompt in one chat | Drafts while that chat is open; approve in the web client |
| Claude Code | `/homingbird` in one session | Drafts by itself; approve in the web client, which each draft in the pane links to |
| ChatGPT, claude.ai, other web connectors | Pick one chat with the connector | Cannot be woken: a phone notification tells you; say "check Homingbird" there, or answer in the web client |

- Every other session drafts only when you ask it ("Ask June whether…").
- **Agent awake** in the directory means your desk is running. A connected agent that is not running
  is not awake, and a note to it waits.
- Approving happens only in the web client. Writing by hand works there too.

The full guide, from signing in to phone notifications, is [`docs/guide.md`](docs/guide.md).

## Usage

**In the browser.** Sign in with your organization account, pick a colleague from the directory, and
write. Drafts from your agents appear in the conversation with **Send**, **Edit** and **Discard**.

**In Claude Code.** At the prompt of a Claude Code session in a terminal, run the line below, answer
`y` to add the marketplace and pick a scope; then type `/homingbird` to open the pane:

```
/plugin install homingbird --marketplace let-sunny/homingbird
```

The marketplace always installs the version of the plugin that this repository's default branch names
in `.claude-plugin/marketplace.json`, the same version as every other package.

Ask in plain words, "Ask June whether the billing migration is safe to run today." Your agent drafts
the note, and it is sent when you approve it. June's approved reply arrives in the same conversation.

**In any MCP client** (Codex, Cursor, Gemini CLI, claude.ai). Register
`https://homingbird.example.com/mcp` as a remote connector, or run the adapter locally as a stdio server:

```sh
npx -y @homingbird/mcp --server https://homingbird.example.com          # any chat session
npx -y @homingbird/mcp --server https://homingbird.example.com --desk   # your one desk session
```

Drafts wait for your approval in the web client.

**Ask a channel** when you do not know who can answer: "Ask the billing channel who owns the nightly export."
It reaches the people who answer questions in billing. When no channel fits, the agent asks a colleague whose
profile matches, or tells you it found no one. Joining a
channel and answering in it are separate switches, and a channel can be private to the people its managers add
([guide](docs/guide.md#join-a-channel-answer-in-it-or-keep-it-private)).

## Commands

The `homingbird` command line is what the plugin runs underneath, and it works on its own
(`npm install -g @homingbird/cli`, Node 22 or newer):

```sh
homingbird login --server https://homingbird.example.com   # sign in this device with a code
homingbird setup --server https://homingbird.example.com --join hbj_… --agent claude
                                                           # on a server: the line from Run on a server
homingbird inbox                                           # notes waiting for a reply
homingbird draft --to june@example.com "Is the billing migration safe to run today?"
homingbird draft --channel billing "Who owns the nightly export?"
homingbird drafts                                          # drafts waiting for approval
homingbird run --agent "codex exec"                        # be the desk: answer what arrives
homingbird stream                                          # live events, one JSON object per line
```

The command line holds an agent credential only: it drafts, and never sends or discards. You approve
in the web client (`homingbird open`). Every command accepts `--json`; the full list is in the
[CLI's README](packages/cli/README.md).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `HB_PUBLIC_URL` | required | The URL people and agents use to reach Dovecote |
| `HB_DATABASE_URL` | `sqlite:./data/dovecote.sqlite` | `sqlite:`, `postgres:` or `mysql:` (MySQL is experimental: tested automatically, not yet used in a real deployment) |
| `HB_OIDC_ISSUER` | `https://accounts.google.com` | Any OpenID Connect issuer |
| `HB_OIDC_CLIENT_ID`, `HB_OIDC_CLIENT_SECRET` | required | From your identity provider |
| `HB_ADMIN_EMAILS` | required | Members who administer the server; nobody becomes one implicitly |
| `HB_ALLOWED_DOMAINS` | none | Email domains whose people may sign in without an invite, comma-separated; unset, only invited people and `HB_ADMIN_EMAILS` get in |
| `HB_CHANNELS` | none | Channels to start with: `slug` or `slug: description`, comma-separated |
| `HB_CONTACT_MODE` | `open` | `open`, or `contacts` to require an accepted request first |
| `HB_TRUST_PROXY` | `0` | Number of proxies in front of Dovecote, when it is reachable only through them ([details](docs/deployment.md#behind-a-load-balancer)) |
| `HB_LOGS` | `audit=full,operational=info,requests=off,auditCopy=off` | What the audit trail and the operational log record ([logs](docs/deployment.md#logs)) |
| `HB_AUDIT_RETENTION_DAYS` | `400` | Days to keep audit rows, at least 90 |
| `HB_ANALYTICS`, `HB_ANALYTICS_URL`, `HB_ANALYTICS_KEY` | `off` | Where anonymous product analytics go, if anywhere ([analytics](docs/deployment.md#product-analytics)) |
| `HB_THEME_DIR` | none | A directory with `theme.css`, `branding.json`, and the fonts and images they use, served under `/theme/` ([guide](docs/guide.md#bring-your-own-web-client)) |

Sessions, credential lifetimes, OAuth clients, push hosts and the rest are in
[`docs/deployment.md`](docs/deployment.md#configuration).

## Security

Nine rules are never broken, and each has a test:

1. Only a human credential can approve a note. Agent credentials can draft, read and pick up, never approve. The contract marks approval routes `access: 'human'` and the domain function checks again.
2. Drafts are invisible to recipients: inbox, stream, search, and lookup by id.
3. No tool exposed to a model can approve, change contacts, or read credentials. No agent integration can approve: approval happens only in a client where the person signed in themself, the web client.
4. Every received note is passed to a model wrapped as quoted data from a colleague, never as instructions. `wrapNote` in `packages/protocol/src/wrap.ts` is the only wrapper; never format a note for a model any other way.
5. Credentials are stored hashed and never logged. Tokens appear in exactly one response, when issued. A token a person gives Homingbird to wake an outside service cannot be hashed: it is stored encrypted, used only in the request that wakes that service, never shown again, and deleted when the person removes it.
6. A member sees only conversations they participate in. An administrator, as a person in the web client only, may also see which private channels exist and who is in them, never their notes, and may read private debate rooms. A private channel's managers are the members of the group that manages it, and only that group's members add people to the channel or to the group: an administrator outside the group can add no one, themself included. Every member sees teams and who is in them; a group made for one channel is shown only to people who can see that channel. Deactivating a member removes them from every group. An administrator's agent credentials get no such exception.
7. No tool exposed to a model can save or change a profile character. Only a person's click saves, and the server validates again; it never trusts a client's check.
8. No tool exposed to a model can save, change, enable, disable or delete a principle. Only a person's action in the web client saves, and the server validates it again.
9. No tool exposed to a model can open a debate room, opt an agent in, change its limits, or approve, post or export its result. A room's content leaves it only through a person: a member exports the closed room, or a person whose agent took a turn posts its result, which is sent like any note only after that person approves it. A turn is shown to the room without approval, so a debate tool returns nothing but room content wrapped by `wrapNote`.

The tests are in [`security-rules.test.ts`](packages/dovecote/test/security-rules.test.ts), one block
per rule, 1 through 9. Where each rule is enforced, and which adapter tests cover it again, is in
[this table](docs/architecture.md#where-the-nine-security-rules-are-enforced-and-tested). See also
[`.claude/rules/security.md`](.claude/rules/security.md) and [`SECURITY.md`](SECURITY.md).

## Develop

Using the published packages needs Node 22 or newer; working on this repository needs Node 22.18 or
newer, because development runs TypeScript files directly. If your shell loads nvm lazily, run
`nvm use` (or check that `node -v` works) before `pnpm dev`.

```sh
pnpm install
pnpm dev          # Dovecote with a development login on http://localhost:8080
pnpm typecheck && pnpm lint && pnpm test
pnpm build        # server, CLI, MCP and web bundles
```

How agents, the server and the web client interact is drawn in
[`docs/architecture.md`](docs/architecture.md). Design decisions are recorded in
[`docs/decisions.md`](docs/decisions.md). Ideas outside the current
scope are in [`docs/roadmap.md`](docs/roadmap.md).

## Contribute

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first. The rules in [`CLAUDE.md`](CLAUDE.md) apply to every
contributor and every coding agent.

Check the [issues](https://github.com/let-sunny/homingbird/issues) before reporting a problem or
asking for a feature, and report security problems privately, as [`SECURITY.md`](SECURITY.md)
describes. A pull request runs `pnpm typecheck && pnpm lint && pnpm test`, records any new design
decision in `docs/decisions.md`, and says why the change is needed.

## License

Code: [MIT License](LICENSE) © 2026 Minseon Kim (let-sunny). The Homingbird name, logo and Pip the pigeon stay with the
project; see [TRADEMARKS.md](TRADEMARKS.md). The built-in profile characters are
[CC BY 4.0](assets/characters/LICENSE.md).
