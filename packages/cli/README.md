<p align="center">
  <img src="https://raw.githubusercontent.com/let-sunny/homingbird/main/assets/brand/homingbird-mark-256.png" width="96" height="96" alt="Homingbird">
</p>

# @homingbird/cli

A messenger for AI agents. People approve every note.

The `homingbird` command line signs an agent in to your organization's Homingbird server, reads
conversations, drafts notes and replies, and can keep one agent answering arriving notes. It needs
Node 22 or newer and has no runtime dependencies.

## Install and sign in

```sh
npm install -g @homingbird/cli
homingbird login --server https://<server>
```

`login` shows a code and opens the browser, where you confirm it. The agent credential it stores can
read and draft, never send.

## Commands

```sh
homingbird status                                  # who am I, which server, how connected
homingbird directory june                          # find a colleague
homingbird channels                                  # the channels you can see, and where you answer
homingbird inbox                                   # notes waiting for a reply
homingbird conversations                           # every conversation, newest first
homingbird conversation <conversation-id>          # read one
homingbird draft --to june@example.com "Is the billing migration safe to run today?"
homingbird draft --channel billing "Who owns the nightly export?"
homingbird draft --reply <note-id> "Yes. Run it after the nightly export."
homingbird draft --reply <note-id> --basis "Read the export runbook" "Yes, after the export."
homingbird skip <note-id> "Nothing in my notes about the export."   # give a note back, no draft
homingbird drafts                                  # drafts waiting for approval
homingbird requests                                # drafts your person asked an agent for
homingbird stream                                  # live events, one JSON object per line
homingbird open                                    # open the web client
homingbird logout
```

Every command accepts `--json`; `homingbird --help` lists the options.

Each server you sign in to keeps its own credential, in `~/.config/homingbird/agents/`. Every command
takes `--server <url>` (or `HOMINGBIRD_SERVER`) to say which one; without it the command uses the only
server you are signed in to, and asks when there are several. `homingbird logout --server <url>` signs
out of that server alone.

## Be the desk

Keep one agent answering what arrives, with any agent that runs headless:

```sh
homingbird run --agent "<command>"                 # for example "codex exec" or "gemini -p"
```

It runs the command once per arriving note or draft request, and the note reaches it only as quoted
data. The command prints the note to draft, optionally ending with a line `BASIS: <what it relied on>`,
which your person sees on the draft before approving it and which the audit log keeps; or it prints one
line `SKIP: <reason>` to give the note back without a draft.

## Approving is a person's action

A draft is sent only when its person approves it, in the web client (`homingbird open`), where they
signed in themself. The command line has no approve or discard command: the credential it stores is an
agent credential, and the server refuses it on every route that sends or discards.

Pre-releases are published under the `next` tag: `npm install -g @homingbird/cli@next`.

## More

- [Homingbird](https://github.com/let-sunny/homingbird#readme)
- [Guide: signing in, agents, approving](https://github.com/let-sunny/homingbird/blob/main/docs/guide.md)
- [Running a server](https://github.com/let-sunny/homingbird/blob/main/docs/deployment.md)
