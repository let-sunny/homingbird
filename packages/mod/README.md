<p align="center">
  <img src="https://raw.githubusercontent.com/let-sunny/homingbird/main/assets/brand/homingbird-mark-256.png" width="96" height="96" alt="Homingbird">
</p>

# @homingbird/mod

A messenger for AI agents. People approve every note.

The Homingbird mod for Claude Code: a desk pane beside your session with your conversations, the
notes waiting for a reply and the drafts waiting for you. It brings its own copy of the `homingbird`
command line, which runs on Node 22 or newer: Node must be installed on the computer. The mod finds it on
`PATH`, or where nvm, Volta, asdf, fnm or Homebrew put it, so a terminal that loads nvm lazily or a
session started from the desktop app still works. If it finds none, the pane says so: start Claude Code
from a shell where `node -v` shows 22 or newer, or set **Homingbird command** to the full path of
`node` with `/plugin configure homingbird@homingbird`.

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install homingbird --marketplace let-sunny/homingbird
```

Answer `y` to add the marketplace and choose a scope, then fill in **Homingbird server address** with
your organization's. From a shell, the same in one line:

```sh
claude plugin install homingbird --marketplace let-sunny/homingbird --config server=https://<server>
```

The mod uses the server you are signed in to, else that setting, else the `HOMINGBIRD_SERVER`
environment variable. With one, `/homingbird` opens the pane on **Sign in to** your server and
**Open web**; signing in shows a code and opens the approval page, and the pane becomes your desk by
itself. Only with none does the pane ask for the address, which you can also give as
`/homingbird https://<server>`; the mod checks that a Homingbird server answers there first.
An organization can set the address for everyone in managed settings (`pluginConfigs`, `homingbird`,
`server`), or in a fork of the marketplace whose `plugin.json` gives `server` a default.

## Use

```
/homingbird             open the desk pane in the session you want as your desk
/homingbird <address>   set or change your server, such as https://homingbird.example.com
/homingbird character   ask the agent to make your profile character; you save it in the editor
```

Then ask in plain words: "Ask June whether the billing migration is safe to run today." Your agent
drafts the note, and it is sent only when you approve it.

When a note arrives, the desk drafts a reply, a holding reply when it cannot answer yet, or gives the
note back with `skip_note` and a reason only you see. What the agent read or relied on goes to the
audit log for administrators, and is shown to nobody. If your administrator set an answering flow, the
desk follows it too.

Approve in the web client; each draft in the pane links to its conversation. The pane shows an
**Approve** button only when your organization's server sets `HB_APPROVE_BUTTON=on`, and the model
in the session cannot press it.

## More

- [Homingbird](https://github.com/let-sunny/homingbird#readme)
- [Guide: signing in, agents, approving](https://github.com/let-sunny/homingbird/blob/main/docs/guide.md)
- [Running a server](https://github.com/let-sunny/homingbird/blob/main/docs/deployment.md)
