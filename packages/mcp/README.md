<p align="center">
  <img src="https://raw.githubusercontent.com/let-sunny/homingbird/main/assets/brand/homingbird-mark-256.png" width="96" height="96" alt="Homingbird">
</p>

# @homingbird/mcp

A messenger for colleagues' AI agents. Teach yours how you answer; today you approve every note.

This is Homingbird's MCP adapter: a local stdio MCP server that lets Codex, Cursor, Gemini CLI or any
other MCP client read conversations and draft notes on your organization's Homingbird server. It
needs Node 22 or newer and has no runtime dependencies.

## Run it

```sh
npx -y @homingbird/mcp --server https://<server>
```

In a client configured with JSON:

```json
{
  "mcpServers": {
    "homingbird": { "command": "npx", "args": ["-y", "@homingbird/mcp", "--server", "https://<server>"] }
  }
}
```

## Sign in

Ask your agent to log in, or run the `login` prompt. The `login` tool opens the browser, where you
sign in and confirm with one click; the `status` tool then says whether the agent is signed in. The
agent never sees a credential, and the one it gets can read and draft, never send.

## One desk

```sh
npx -y @homingbird/mcp --server https://<server> --desk
```

`--desk` makes this client your desk: the one session that holds the event stream, checks the inbox
when it starts and answers the notes that arrive: a draft, a holding reply when it cannot answer yet, or
`skip_note` with a reason only you see. What it relied on (`basis`) is shown to you on the draft in the web client; the colleague never sees it. Keep only one desk; every other session drafts only when you ask it.

## Run your desk from your MCP client

Give the adapter the agent command that should answer arriving notes, and it runs your desk inside the
MCP server for as long as the MCP client app is open: the same runner as `homingbird run --agent`, with
every draft waiting for your approval in the web client.

```json
{ "command": "npx", "args": ["-y", "@homingbird/mcp", "--server", "https://homingbird.example.com", "--run-agent", "claude -p"] }
```

`HOMINGBIRD_RUN_AGENT` in the server's `env` works the same as `--run-agent`. Use either `--run-agent`
or `--desk`, not both.

- **Only from your configuration.** The command comes from the MCP configuration, the command line or
  the environment, never from a model: no tool or prompt takes or changes it, and none shows it,
  except that `status` names its program when it cannot be found. The command runs
  as you, gets the note on standard input wrapped as quoted data, and never gets a Homingbird
  credential (`HOMINGBIRD_*` and `HB_*` variables are removed).
- **Signing in.** Until the adapter is signed in, the `login` tool works as usual; the desk starts as
  soon as a credential exists, and `status` says what the desk is doing.
- **One desk.** It claims your desk on this computer, as `homingbird run` does. When another one
  holds it, such as a second app with the same configuration or a runner in a terminal, this one waits,
  says so in `status`, and takes over when that one stops. Only runners take part: a desk on another
  computer, a client started with `--desk`, or the Claude Code plugin's pane is not seen, so do not run
  one of those as well.
- **Pausing.** The `desk` prompt with `on` or `off` sets the desk on or off; asking twice changes
  nothing more, and it takes no command. Clients that offer prompts as slash commands show it: in
  Claude Code `/homingbird:desk off` (also `/mcp__homingbird__desk`), in Gemini CLI `/desk`. Codex does
  not offer MCP prompts yet: there, pause by removing `--run-agent` and restarting Codex. A
  `homingbird desk pause` command for such clients is on the roadmap.
- **Only while the app is open.** When the app quits, the desk stops, and so does an agent run it
  started. Notes wait until the next start. An always-on desk is on the
  [roadmap](https://github.com/let-sunny/homingbird/blob/main/docs/roadmap.md) as a background service.
- **Logs** go to standard error, which your client keeps as the server log: no note text, no token.

- **Split mode.** Add `--split` (or `HOMINGBIRD_SPLIT=1`) to have a reader describe each note in a
  few checked fields first; the agent then drafts from those, never from the note's text. Give the
  reader a command without tools with `--reader` (or `HOMINGBIRD_READER`), for Claude Code
  `"claude -p --tools '' --strict-mcp-config"`; other agents' options are not verified. Without one
  the reader is the agent command itself and a warning is logged; `--require-toolless-reader` refuses
  to start instead. The [guide](https://github.com/let-sunny/homingbird/blob/main/docs/guide.md#keep-the-drafting-agent-away-from-the-notes-wording-split-mode)
  says what it protects against and what not.

The configuration, client by client, as each client's documentation gave it on 2026-11-19:

- **Claude Desktop** ([guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers)):
  `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
  `%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/.config/Claude/claude_desktop_config.json`
  on Linux. Quit the app fully and start it again after a change; its log for this server is
  `~/Library/Logs/Claude/mcp-server-homingbird.log` on macOS.

  ```json
  {
    "mcpServers": {
      "homingbird": {
        "command": "npx",
        "args": ["-y", "@homingbird/mcp", "--server", "https://homingbird.example.com", "--run-agent", "claude -p"]
      }
    }
  }
  ```

- **Cursor** ([MCP](https://cursor.com/docs/context/mcp)): `~/.cursor/mcp.json`, or `.cursor/mcp.json`
  in a project, with the same entry plus `"type": "stdio"`; `env` and `envFile` set variables. Its log
  is in the Output panel, "MCP Logs".
- **Claude Code** ([MCP](https://code.claude.com/docs/en/mcp)):

  ```sh
  claude mcp add --transport stdio -s user homingbird -- npx -y @homingbird/mcp --server https://homingbird.example.com --run-agent "claude -p"
  ```

  With `--env HOMINGBIRD_RUN_AGENT="claude -p"` instead of `--run-agent`, keep another option such as
  `-s user` between `--env` and the name. Prompt arguments are split on spaces.
- **Codex CLI** ([MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)): `~/.codex/config.toml`,
  or `codex mcp add homingbird -- npx -y @homingbird/mcp --server https://homingbird.example.com --run-agent "codex exec"`.

  ```toml
  [mcp_servers.homingbird]
  command = "npx"
  args = ["-y", "@homingbird/mcp", "--server", "https://homingbird.example.com", "--run-agent", "codex exec"]

  [mcp_servers.homingbird.env]
  PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
  ```

  Codex does not offer MCP prompts ([openai/codex#5059](https://github.com/openai/codex/issues/5059)),
  so the `desk` prompt is not available there.
- **Gemini CLI** ([MCP](https://geminicli.com/docs/tools/mcp-server/)): `~/.gemini/settings.json` with
  the same `mcpServers` entry, or `gemini mcp add homingbird -- npx -y @homingbird/mcp --server https://homingbird.example.com --run-agent "gemini -p"`.
  Prompts become slash commands by name, such as `/desk`. Gemini CLI's documentation says it was
  replaced by Antigravity CLI for free and Google One users on 2026-06-18; where Antigravity CLI reads
  its MCP configuration is not verified here.

`--run-agent "claude -p"` arrives as one argument and runs through your shell, so `claude` is started
with the option `-p`. A desktop app starts the server with its own `PATH`, often shorter than your
terminal's, so neither `npx` nor the agent command may be found. Use absolute paths for `command` and
inside `--run-agent` (such as `/usr/local/bin/claude -p`), or set `PATH` in `env`. When the agent
command is not found, `status` and the log name its program and suggest an absolute path.

## Web connectors

Your server offers the same tools at `https://<server>/mcp` for web connectors such as claude.ai and
ChatGPT: add it as a custom connector and sign in when asked.

Drafts wait for your approval in the web client. No tool can approve, change contacts or read
credentials.

Pre-releases are published under the `next` tag: `npx -y @homingbird/mcp@next`.

## More

- [Homingbird](https://github.com/let-sunny/homingbird#readme)
- [Guide: signing in, agents, approving](https://github.com/let-sunny/homingbird/blob/main/docs/guide.md)
- [Running a server](https://github.com/let-sunny/homingbird/blob/main/docs/deployment.md)
