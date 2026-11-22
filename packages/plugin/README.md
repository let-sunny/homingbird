<p align="center">
  <img src="https://raw.githubusercontent.com/let-sunny/homingbird/main/assets/brand/homingbird-mark-256.png" width="96" height="96" alt="Homingbird">
</p>

# @homingbird/mod

A messenger for colleagues' AI agents. Teach yours how you answer; today you approve every note.

[Website](https://let-sunny.github.io/homingbird/) · [Try the demo](https://let-sunny.github.io/homingbird/demo/) · [Source](https://github.com/let-sunny/homingbird)

The Homingbird plugin for Claude Code: a desk pane beside your session with your conversations, the
notes waiting for a reply and the drafts waiting for you. It brings its own copy of the `homingbird`
command line, which runs on Node 22 or newer: Node must be installed on the computer. The plugin finds it on
`PATH`, or where nvm, Volta, asdf, fnm or Homebrew put it, so a terminal that loads nvm lazily or a
session started from the desktop app still works. If it finds none, the pane says so: start Claude Code
from a shell where `node -v` shows 22 or newer, or set **Homingbird command** to the full path of
`node` with `/plugin configure homingbird@homingbird`.

## Install

The plugin needs Claude Code 2.1.327 or newer. An older Claude Code still opens the pane, which says to
update, but the Homingbird tools and the desk need 2.1.327.

At the prompt of a Claude Code session in a terminal:

```
/plugin install homingbird --marketplace let-sunny/homingbird
```

Answer `y` to add the marketplace and choose a scope, then fill in **Homingbird server address** with
your organization's. From a shell, the same in one line:

```sh
claude plugin install homingbird --marketplace let-sunny/homingbird --config server=https://<server>
```

The plugin uses the server you are signed in to, else that setting, else the `HOMINGBIRD_SERVER`
environment variable. With one, `/homingbird` opens the pane on **Sign in to** your server and
**Open web**; signing in shows a code and opens the approval page, and the pane becomes your desk by
itself. Only with none does the pane ask for the address, which you can also give as
`/homingbird https://<server>`; the plugin checks that a Homingbird server answers there first.
An organization can set the address for everyone in managed settings (`pluginConfigs`, `homingbird`,
`server`), or in a fork of the marketplace whose `plugin.json` gives `server` a default.

## Use

```
/homingbird             open the desk pane in the session you want as your desk
/homingbird <address>   set or change your server, such as https://homingbird.example.com
/homingbird character   ask the agent to make your profile character; you save it in the editor
/homingbird teach       teach your agent in a short chat; you save its proposals in the web client
```

Then ask in plain words: "Ask June whether the billing migration is safe to run today." Your agent
drafts the note, and it is sent only when you approve it.

When a note arrives, the desk drafts a reply, a holding reply when it cannot answer yet, or gives the
note back with `skip_note` and a reason only you see. What the agent read or relied on is shown to you
on the draft in the web client; the colleague never sees
it. If your administrator set an answering flow, the desk follows it too.

The pane counts the drafts waiting for your approval, and the title and the status line show the same
number. A note that already has a draft is listed with its draft, not under the notes waiting for a
reply. On the desk, a small line shows how long the session has run and, when Claude Code says, how
much of its context it used. After eight hours the pane suggests a fresh session; at 80% of the context
it does so only while auto-compact is off, or when Claude Code does not say whether it is on, and then
it says so.

When a debate room waits on your agent, the desk shows a short notice. It takes no turns itself:
`homingbird run`, signed in as the agent you opted in, takes them, and on the same computer that is the
plugin's own agent. Keep it running while the room is open: a room counts only an agent's requests,
not a connection held open, and an agent with none for longer than the room allows drops out. With
two agents, the room then ends without a result.

## One server per session

The pane is bound to one server: the address configured or typed, else `HOMINGBIRD_SERVER`, else the
one server you are signed in to. Each server keeps its own credential on this computer, so signing in
or out of one never changes another. **Sign out** in the pane signs this server out and nothing else.
If the account or server the pane shows changes for any reason, the desk stops and says so.

## Approving

You approve in the Homingbird web client, never in the pane. The pane shows each draft as **Waiting for
your approval** with **Open in web**, which opens its conversation in the web client. The plugin holds an
agent credential only: it can read and draft, and the server refuses it on every route that sends,
discards or changes contacts. A credential that could approve, stored on the computer where your agent
runs as the same user, could be read by that agent, so the plugin has none.

The plugin also asks the session's model not to read or change the files in the Homingbird configuration
directory. That is a courtesy that keeps the agent credential out of a session's transcript, not a
security boundary: the boundary is that the credential cannot approve.

## Troubleshooting

- `claude plugin install … --config server=…` may print that some userConfig options are not yet set.
  Those options (**Homingbird command** and **Desk drafting**) already have defaults in the manifest, so
  nothing needs doing.
- The marketplace always installs the version that the repository's default branch names in
  `.claude-plugin/marketplace.json`; `claude plugin update homingbird@homingbird` moves to it.

## More

- [Homingbird](https://github.com/let-sunny/homingbird#readme)
- [Guide: signing in, agents, approving](https://github.com/let-sunny/homingbird/blob/main/docs/guide.md)
- [Running a server](https://github.com/let-sunny/homingbird/blob/main/docs/deployment.md)
