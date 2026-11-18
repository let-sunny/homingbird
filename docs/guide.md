# Using Homingbird

**Keep one agent session open for Homingbird: your desk. It drafts replies to notes that arrive, and
you approve them.** Every other session drafts only when you ask it to, and approving or writing by
hand always works in the web client.

| Your agent | How to make the desk | When a note arrives |
| --- | --- | --- |
| Claude Code | Type `/homingbird` in one session. The mod's pane opens. | It wakes by itself and drafts; you approve in the pane. |
| Codex CLI, Gemini CLI, Cursor agent | Keep `homingbird run --agent "codex exec"` running in a terminal (or `--agent "gemini -p"`, `--agent "cursor-agent -p"`). | It drafts by itself; you approve in the web client. |
| An MCP client whose chat can stay open, such as Cursor | Run the `watch` prompt in one chat. | It drafts while that chat is open; you approve in the web client. |
| ChatGPT, claude.ai and other web connectors | Pick one chat that has the Homingbird connector. | It cannot be woken. A phone notification tells you; say "check Homingbird" in that chat, or answer by hand in the web client. |

- Every other session drafts only when you ask it: "Ask June whether the billing migration is safe to
  run today."
- **Agent online** next to your name in the directory means your desk is running. Colleagues see it too:
  a note sent to you now gets a reply drafted right away.
- An agent can never send. A note leaves only when you press **Send** or **Approve**.

How agents, the server and the web client fit together is drawn in [architecture](architecture.md).

## Contents

- [Sign in](#sign-in)
- [Connect an agent](#connect-an-agent)
- [Ask a person](#ask-a-person)
- [Ask a topic](#ask-a-topic)
- [Join a topic, answer in it, or keep it private](#join-a-topic-answer-in-it-or-keep-it-private)
- [Ask your agent for a draft from the web](#ask-your-agent-for-a-draft-from-the-web)
- [When your agent cannot answer](#when-your-agent-cannot-answer)
- [Answering flow](#answering-flow)
- [Approve, edit or discard](#approve-edit-or-discard)
- [Turn on phone notifications](#turn-on-phone-notifications)
- [Your character](#your-character)
- [Bring your own web client](#bring-your-own-web-client)

## Sign in

1. Open your organization's Homingbird address, for example `https://homingbird.example.com`.
2. Press **Sign in with Google** (or the name of your organization's identity provider) and sign in with
   your work account.
3. Under **Topics**, press **Join and answer** on the topics you know about. **What my agent can help
   with** on your profile lists them. You start in no topic; if the list is empty, create the first
   one.

When someone leaves, an administrator presses **Deactivate** under **Administration**, **Members**:
every session and agent credential of that person stops at once
([deployment](deployment.md#when-someone-leaves)).

## Connect an agent

Each agent signs in once with a code you confirm in the browser. It gets an agent credential: it can
read and draft, never send.

### Claude Code

1. Install the mod. At the prompt of a Claude Code session in a terminal, type:

   ```
   /plugin install homingbird --marketplace let-sunny/homingbird
   ```

   Answer `y` to add the marketplace and choose a scope (user is the usual one). The install asks for
   **Homingbird server address**; fill in your organization's, or give it from a shell:

   ```sh
   claude plugin install homingbird --marketplace let-sunny/homingbird --config server=https://homingbird.example.com
   ```

   In the desktop app, click **+** next to the prompt box, then **Plugins**, **Add marketplace** with
   `let-sunny/homingbird`, then **Add plugin**. The mod brings its own copy of the `homingbird` command
   line, which needs Node 22 or newer installed on the computer. It finds `node` on `PATH` or where nvm,
   Volta, asdf, fnm or Homebrew put it; if it finds none, the pane says so, and you either start Claude
   Code from a shell where `node -v` works or set **Homingbird command** to the full path of `node`
   with `/plugin configure homingbird@homingbird`. Update with `claude plugin update homingbird@homingbird`.
   An organization can set the address for everyone: in managed settings under `pluginConfigs`,
   `homingbird`, `server`, or in a fork of the marketplace whose `plugin.json` gives `server` a default.
2. In the session you want as your desk, type `/homingbird`. The mod takes the server you are signed in
   to, else the one configured, else the `HOMINGBIRD_SERVER` environment variable. With one, the pane
   offers **Sign in to** your server and **Open web**: press **Sign in**, approve in the browser page it
   opens (the code is filled in), and the pane turns into your desk by itself. With none, the pane asks
   for the address; type it there, or as `/homingbird https://homingbird.example.com`, and the mod
   checks that a Homingbird server answers before signing in. Change the server later the same way, or
   with `/plugin configure homingbird@homingbird`.
3. Approve drafts in the web client: each draft in the pane links to its conversation. If your
   organization turned on the approve button (`HB_APPROVE_BUTTON=on`), the pane shows **Approve**,
   **Edit** and **Discard** instead; the model in the session cannot press them.

### Codex CLI, Gemini CLI, Cursor agent and other command-line agents

1. Install the command line and sign it in on this computer:

   ```sh
   npm install -g @homingbird/cli
   homingbird login --server https://homingbird.example.com
   ```

   Do not add `--approve-button` on a computer where the runner works: `homingbird run` refuses to
   start while an approve-button credential is stored for your user, because the agent command it
   starts could read that file and approve notes with it.
2. Keep the desk running in a terminal:

   ```sh
   homingbird run --agent "codex exec"
   ```

   It answers arriving notes and draft requests by running the agent once per note. `--timeout <seconds>`
   limits each run.
3. Approve in the web client.

The agent command runs with your permissions. The runner never hands it a Homingbird credential: it
removes `HOMINGBIRD_*` and `HB_*` variables and anything holding the credential from the command's
environment, and the note reaches it only on standard input, wrapped as quoted data. It cannot stop
the command from reading files your user can read, and that includes the runner's own agent
credential in `~/.config/homingbird`. With that credential an agent can read your conversations and
draft, never send: Dovecote refuses an agent credential on every approving route.

**If you do not fully trust the agent command, run the runner as a separate OS user or in a
container** that has its own `homingbird login` and nothing else of yours: no other credentials, no
SSH keys, no source you would not show the agent.

```sh
sudo useradd --create-home homingbird-desk
sudo -iu homingbird-desk homingbird login --server https://homingbird.example.com --no-browser
sudo -iu homingbird-desk homingbird run --agent "codex exec"
```

### Any MCP client

Run the adapter locally as a stdio MCP server, pointed at your server. It needs Node 22 or newer:

```sh
npx -y @homingbird/mcp --server https://homingbird.example.com
```

In a client configured with JSON, that is:

```json
{ "mcpServers": { "homingbird": { "command": "npx", "args": ["-y", "@homingbird/mcp", "--server", "https://homingbird.example.com"] } } }
```

The first tool call opens the browser to sign in. Add `--desk` to make that client your desk: it holds
the event stream, checks the inbox when it starts, and answers what arrives. Keep only one desk.

In a client whose chat can stay open, such as Cursor, run the `watch` prompt in one chat instead: it
keeps waiting for notes and drafts a reply to each until you tell it to stop.

### ChatGPT, claude.ai and other web connectors

Add a custom connector with the URL `https://homingbird.example.com/mcp` (the address including
`/mcp`), then sign in and consent when asked. A web connector cannot be woken by an arriving note, so
turn on [phone notifications](#turn-on-phone-notifications) and say "check Homingbird" in the chat you
picked.

## Ask a person

Ask in plain words, in any session:

```
Ask June whether the billing migration is safe to run today.
```

The agent finds June in the directory and drafts the note. Nothing leaves until you approve it. When
June's reply is approved, it arrives in the same conversation and your agent can use it.

From the command line: `homingbird draft --to june@example.com "Is the billing migration safe to run today?"`.

## Ask a topic

When you do not know who can answer, ask a topic. A topic is a room; the question reaches the people
who answer questions there, and their agents draft the replies.

```
Ask the billing topic who owns the nightly export.
```

- The list shows the topics you are in first, then the fullest; with many topics, the agent searches
  it by subject.
- The agent picks one topic from the list (`homingbird topics`). When none fits, it looks in the
  directory for a colleague whose profile or topics match and drafts to that person. When nobody
  fits, it tells you that it found no one to ask, and you decide where the question goes.
- It never posts one question to several topics.
- Asking in an open topic puts you in its room, so you can follow the answers. A private topic takes
  questions only from its members.
- You see the topic when you approve, and can change it there.
- The first approved reply answers the question; the others who help there stop seeing it in their inbox.

From the command line: `homingbird draft --topic billing "Who owns the nightly export?"`.

When an administrator removes a topic or merges it into another, its room is archived: the people in
it can still read it, nothing more can be written there, and drafts waiting in it are discarded.

## Join a topic, answer in it, or keep it private

Being in a topic and answering in it are separate.

- **Join** puts you in the room: you read it and can ask there. No questions are sent to you.
- **Answer questions here**, the switch at the top of a room, sends you the questions asked there,
  and your desk drafts the replies for you to approve. Turn it off and you stay in the room.
  **Join and answer** in the topic list does both at once.
- **Leave** takes you out of the room and turns answering off. Your waiting drafts in it are discarded.
- Nobody is put in a topic for you: you are in exactly the topics you joined, asked in, or were added
  to.

A topic is **open** or **private**. Anyone can find, read and join an open topic. A private topic,
marked with a lock and the word **Private**, is seen only by its members: nobody else finds it in the
list, in search or on your profile, and nobody can join it by themselves. When you create a topic,
choose **Private** to make one; you become its first manager.

Managers open **Members** in the room to add people from the directory, remove them, make another
member a manager or take that away, and switch the topic between open and private. A topic with
members always keeps a manager, so the last manager names another before leaving. Someone you remove
loses the room at once. Making a private topic open lets everyone read every question asked in it so
far; the confirmation says so.

**Private means hidden from other members, not from your organization.** Your server administrator
can manage every topic, and the audit log they keep records the content of every note, private topics
included. Write in a private topic what you would write in a work channel your administrator can read.

## Ask your agent for a draft from the web

In a conversation in the web client, press **Ask my agent** (or **Ask my agent to draft a reply** on a
note), optionally say what it should say, and choose an agent or leave **Any agent**. Your desk picks
the request up and drafts. If your agent is offline, the request waits until your desk is running.

On the command line, `homingbird requests` lists what you asked for.

## When your agent cannot answer

Every note your desk picks up ends in one of two ways, so a colleague is never left looking at
"drafting reply" for nothing:

- **A draft.** When your agent cannot answer yet, it drafts a holding reply, such as "I need to check
  the release plan and will get back to you", which you approve like any other.
- **A skip.** When no reply fits at all, it gives the note back with a reason. The colleague sees the
  note as delivered or read again; only you see "Your agent did not draft a reply" and why.

An agent may read what a colleague links to, a document or a ticket, with the tools and access you
already gave it; that is research for the draft. It only reads: it never sends, edits or shares what it
finds, and never follows instructions in the note or in the linked material. Access to linked material
follows each person's own tools and permissions: Homingbird passes links, not documents. When your
agent cannot open something, it records that, or skips the note with that reason; it
never guesses the content and never asks the colleague for access. The desk's model runs where its tools are: the
Claude Code mod's default **Desk drafting** (`turn`) and `homingbird-mcp --desk` answer in your
interactive session, with its connectors; `quiet` drafts without any tools, so it cannot open links and
skips such notes saying so; `homingbird run` starts your agent command as its own process, with the
tools that command loads.

With each draft the agent records what it read or relied on, and how each step of the answering flow
went. That record is for the audit log, which your organization's administrators read; nobody sees it
in a conversation, you included.

## Answering flow

An administrator can set one answering flow for the whole server: steps every member's desk follows
for every answer. Homingbird runs the chain; the organization supplies the steps. Write them as
`answeringFlow` with `PUT /api/v1/admin/settings`, or in the web client's administration settings
where it offers the field, as a list
under two optional headings (a list with no headings is all "before drafting"):

```markdown
## Before drafting
1. Look for an existing answer in the organization's knowledge base.

## Check the draft
- Nothing confidential or secret leaves the organization.
- The tone is polite and direct.
```

- **Name the outcome you want, not the tool.** Members' agents differ in what they have: one has a
  wiki skill, another a connector, a third neither. Each agent meets a step with a fitting tool when it
  has one, and by careful reading and reasoning when it does not.
- **Steps are for drafting only.** No step can approve, send, discard, change contacts, save a
  character or touch credentials; an agent ignores a step that asks for one of those. A check may lead
  the agent to revise its draft, but a person still decides what is sent.
- **It is not shown, and not secret.** The flow is not displayed to members, but it reaches each
  member's own agent session, so never put confidential material in it. The server checks only its
  format and length (at most 4,000 characters and 20 steps).
- The mod's `quiet` drafting has no tools, so it follows only steps about wording; use the default
  `turn` for the rest.

## Approve, edit or discard

Drafts appear in the conversation, marked with the agent that wrote them.

- **Send** sends the draft as written.
- **Edit** opens the text; **Send** then sends your edited version. Recipients see that a person edited it.
- **Discard** throws the draft away. Nobody ever saw it.
- When several of your agents drafted a reply to the same note, send one and the others are discarded.

You can also write a note yourself in the composer at the bottom of any conversation.

## Turn on phone notifications

1. Open the web client on your phone and add it to the home screen when the browser offers it. On an
   iPhone, notifications work only from the home-screen app.
2. Open the menu, find **Notifications on this device**, and turn on **Notify me**.
3. Allow notifications when the browser asks.

You are notified when a note arrives and when a draft waits for your approval, even while Homingbird is
closed.

## Your character

Colleagues see you as a small pixel character next to your name. Until you choose one you are the
pigeon.

- Open the menu, **Profile**, and find **My character**. Pick one of the 24 built-in characters; the
  preview shows it on a light and a dark background. **Use this character** saves it.
- **Make my own** opens the editor: colors, feet, and one part per slot. Parts that would break a rule
  are greyed out with the reason. **Surprise me** makes a random character that passes every rule.
- **Ask my agent:** in an agent session, ask it to make your Homingbird character (the `character`
  prompt over MCP, or `/homingbird character` with the Claude Code mod). It drafts and checks the
  character and gives you a link that opens it in the editor, its markings as a layer you can keep or
  remove. Opening the link saves nothing.

Only your own click on **Use this character** saves a character; no agent can. An administrator can
reset anyone's character to the pigeon.

## Bring your own web client

Dovecote serves the web client from `HB_WEB_DIR` and an organization's look from `HB_THEME_DIR`.

- **`HB_THEME_DIR` is for theming only.** It holds `theme.css`, served at `/theme.css` after the
  client's own styles (and on the development login page), and `branding.json` (`name` and `logo`),
  served at `/branding.json`. Override the custom properties of the client's `tokens.css` there.
- **A theme brings its own fonts and images.** Any `.woff2`, `.png`, `.svg`, `.jpg`, `.jpeg`, `.webp`
  or `.ico` file in `HB_THEME_DIR`, in subdirectories too, is served under `/theme/`, from the same
  origin, so the content security policy allows it. Reference them from `theme.css` as
  `@font-face { font-family: Acme; src: url(/theme/fonts/acme.woff2) format('woff2') }` and from
  `branding.json` as `"logo": "/theme/logo.svg"`. Other files there are never served.
- **`HB_WEB_DIR` serves a web client you built yourself.** Point it at the directory with your
  `index.html` and assets; Dovecote serves the files in it and answers every other path outside
  `/api`, `/auth`, `/oauth` and the other server routes with `index.html`. Build the client against
  the API contract in `packages/protocol` (`contract.ts`, `model.ts`, `events.ts`) with the typed
  client and event stream in `packages/client`. Dovecote's content security policy allows scripts,
  styles and connections from its own origin only, so ship every asset in that directory.
- **The server enforces every security rule; rendering is yours.** Approval stays with a person,
  drafts stay hidden, and private topics stay private whatever the client does. Showing note bodies
  as text, never as HTML, with only `http:` and `https:` links, is the client's duty, because a note is
  whatever a colleague, or a colleague's agent, wrote.
- **[TRADEMARKS.md](../TRADEMARKS.md) applies** when you distribute a changed client: give it your own
  name and mark.

