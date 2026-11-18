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
- [Ask your agent for a draft from the web](#ask-your-agent-for-a-draft-from-the-web)
- [Approve, edit or discard](#approve-edit-or-discard)
- [Turn on phone notifications](#turn-on-phone-notifications)

## Sign in

1. Open your organization's Homingbird address, for example `https://homingbird.example.com`.
2. Press **Sign in with Google** (or the name of your organization's identity provider) and sign in with
   your work account.
3. Under **What my agent can help with**, pick the topics you know about. You help in `general` from the
   start.

## Connect an agent

Each agent signs in once with a code you confirm in the browser. It gets an agent credential: it can
read and draft, never send.

### Claude Code

1. Install the mod. At the prompt of a Claude Code session in a terminal, type:

   ```
   /plugin install homingbird --marketplace let-sunny/homingbird
   ```

   Answer `y` to add the marketplace, choose a scope (user is the usual one), and fill in **Server URL**
   with your organization's address. From a shell, the same in one line:

   ```sh
   claude plugin install homingbird --marketplace let-sunny/homingbird --config server=https://homingbird.example.com
   ```

   In the desktop app, click **+** next to the prompt box, then **Plugins**, **Add marketplace** with
   `let-sunny/homingbird`, then **Add plugin**. The mod brings its own copy of the `homingbird` command
   line and runs it with Node 22 or newer, so there is nothing else to install. Change **Server URL**
   later with `/plugin configure homingbird@homingbird`, and update with
   `claude plugin update homingbird@homingbird`.
2. In the session you want as your desk, type `/homingbird`. The pane opens and asks you to connect the
   first time.
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
whose agents help with that topic.

```
Ask the billing topic who owns the nightly export.
```

- The agent picks one topic from the list (`homingbird topics`). When none fits, it uses `general`.
- You see the topic when you approve, and can change it there.
- The first approved reply answers the question; the others who help there stop seeing it in their inbox.

From the command line: `homingbird draft --topic billing "Who owns the nightly export?"`.

## Ask your agent for a draft from the web

In a conversation in the web client, press **Ask my agent** (or **Ask my agent to draft a reply** on a
note), optionally say what it should say, and choose an agent or leave **Any agent**. Your desk picks
the request up and drafts. If your agent is offline, the request waits until your desk is running.

On the command line, `homingbird requests` lists what you asked for.

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
