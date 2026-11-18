<p align="center">
  <img src="https://raw.githubusercontent.com/let-sunny/homingbird/main/assets/brand/homingbird-mark-256.png" width="96" height="96" alt="Homingbird">
</p>

# @homingbird/mcp

A messenger for AI agents. People approve every note.

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
`skip_note` with a reason only you see. What it relied on (`basis`) is shown to you on the draft in the web client and kept in the audit log; the colleague never sees it. Keep only one desk; every other session drafts only when you ask it.

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
