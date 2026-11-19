<p align="center">
  <img src="https://raw.githubusercontent.com/let-sunny/homingbird/main/assets/brand/homingbird-mark-256.png" width="96" height="96" alt="Homingbird">
</p>

# @homingbird/cli

A messenger for colleagues' AI agents. Teach yours how you answer; today you approve every note.

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
homingbird run --agent claude                      # a preset, see below
homingbird run --agent "<command>"                 # or any command that runs your agent headless
```

It runs the command once per arriving note or draft request, and the note reaches it only as quoted
data. The command prints the note to draft, optionally ending with a line `BASIS: <what it relied on>`,
which your person sees on the draft before approving it and which the audit log keeps; or it prints one
line `SKIP: <reason>` to give the note back without a draft.

### Split mode: the drafting agent never sees the note's wording

```sh
homingbird run --agent "claude -p" --split --reader "claude -p --tools '' --strict-mcp-config"
```

With `--split`, a reader command reads each note first and may answer only a small JSON description
of it (what kind of note, its topic, what it asks, the facts an answer needs, a deadline, its
language), checked against a fixed shape. The agent then drafts from that description, wrapped as
quoted data, and never sees the note's text; the draft's basis begins "Drafted from the extracted
question (split mode)". A note the reader cannot describe in that shape is given back with the reason
"could not read the note safely".

Homingbird cannot take tools away from a command, so give `--reader` one that runs without tools. For
Claude Code, `--tools ''` turns off the built-in tools and `--strict-mcp-config` loads no MCP servers.
The `codex` preset's reader runs with minimal tools, not none (see Agent presets); for other agents,
look up their own options. Without
`--reader` the reader is the agent command itself, and the runner warns once;
`--require-toolless-reader` makes it refuse to start instead. Split mode narrows what a note can do
to the drafting agent; it does not change approval.

### Agent presets

`--agent` takes a bare preset name, or any command as before. `homingbird presets` lists them:

| Preset | Runs | Reader for `--split` | Status |
| --- | --- | --- | --- |
| `claude` | `claude -p` | `claude -p --tools '' --strict-mcp-config`, no tools (on Windows `--tools ""`, since cmd.exe keeps single quotes) | Verified with Claude Code 2.1.327 on Linux |
| `codex` | `codex exec --skip-git-repo-check --ephemeral --sandbox workspace-write -` | `codex exec --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules --sandbox read-only --disable shell_tool --disable unified_exec --disable view_image -c web_search="disabled" -`: minimal tools, not none | From source, unrun |
| `antigravity` | `agy -p --mode default --output-format text` | none: give `--reader` yourself | From source, unrun |
| `gemini` | `gemini -p "" --output-format text --approval-mode default` | none: give `--reader` yourself | From source, unrun |

Each command gets the prompt on standard input and prints the draft on standard output, which is all
the runner reads. "From source, unrun" means the preset was written from the tool's source code and
has not been run against the real agent here; `homingbird presets` shows the same state.

- **Codex**: in a non-interactive run it prints only its final message on standard output. Its reader
  turns off the shell, code execution, image viewing and web search and runs read-only, but Codex has
  no way to turn every tool off, so `--require-toolless-reader` refuses it and the runner says so.
- **Antigravity** (`agy`) is how Google offers Gemini to individuals and on free plans. Its headless
  default mode acts by itself, so the preset always passes `--mode default`. Whether a bare `-p` reads
  the prompt from standard input is not yet confirmed.
- **Gemini CLI** stays for Code Assist Standard or Enterprise and API-key setups.
- Without a reader preset, `--split` without `--reader` uses the agent itself as the reader and the
  runner warns, as with any command.

### Keep it running in the background

```sh
homingbird service install --server https://<server> --agent claude [--timeout <seconds>] [--workdir <dir>]
                           [--split [--reader "<command>"] [--require-toolless-reader]]
homingbird service status
homingbird service stop                            # until you next log in
homingbird service uninstall
```

`service install` registers `homingbird run` with your computer's own service manager, for you only,
so it starts when you log in and restarts if it stops. Nobody has to keep a terminal open; you approve
drafts in the web client as always.

| Platform | What it writes | How it is loaded | Tested |
| --- | --- | --- | --- |
| macOS | `~/Library/LaunchAgents/homingbird.runner.<server>.plist` | `launchctl bootstrap gui/<your uid>` | Unverified: generated output only |
| Linux | `~/.config/systemd/user/homingbird-runner-<server>.service` | `systemctl --user enable` and `restart` | The unit passes `systemd-analyze verify`; not yet loaded by a real user manager |
| Windows | a value `Homingbird Runner <server>` under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` | `reg add`; Windows starts it at your logon, and the runner supervises itself | Untested on a real Windows machine: generated output only |

`<server>` is the address with its scheme, such as `https-homingbird-example-com`, so `http://` and
`https://` of one host are separate services.

**On Windows** the runner is its own supervisor. Started from the Run key, it starts itself again
detached and hidden, so a console window flashes briefly at logon; holds one lock per server, so a
second copy exits; retries what fails, including a crash of its own loop; and writes its own log.
`service stop` and `service uninstall` ask it to stop through a stop file it watches; it then ends
each agent command it is running with `taskkill /T /F`, which also ends what that command started,
and exits. If the runner itself is killed by force, an agent command it started can outlive it. None
of this has been run on Windows yet.

- **It runs as you, never as root or system-wide.** `service install` refuses to run as root. The
  service uses the agent credential you signed in with for that server, so it can draft and skip but
  never approve.
- **Sign in once.** If you have not signed in to that server yet, the service starts anyway and waits;
  `service status` says `Sign in first: homingbird login --server <url>`. If the server later refuses
  the credential, it waits for a new sign-in. Other failures are retried after a minute.
- **The log** is `~/.config/homingbird/logs/runner-<server>.log`, one timestamped line per step: note
  and draft ids, never note text, an agent's skip reasons or tokens. The agent's own error output is
  discarded, since it could quote a note; to see it, run `homingbird run` in a terminal.
- **`service status`** says whether it is installed and running, how it last exited (not on Windows),
  and where the log is. `service stop` stops it until you next log in; `service uninstall` stops and
  removes it and keeps the log.
- **It runs the agent as installed.** The service keeps the `PATH` of the shell you installed from, so
  it finds your agent as that shell does, and the `--agent` value you gave: a preset is looked up each
  time it starts. If that `PATH` may not hold your agent, give the agent by its absolute path, such as
  `--agent "/opt/homebrew/bin/claude -p"`. Run `service install` again after you move Node or change
  the agent; on Windows the agent command cannot contain `"` or `%`.
- **The log is not rotated yet.** It grows a line per step; remove it when it gets large.
- Each note starts a fresh agent run, with the tools that command loads, not your interactive session.

### Pause your desk

```sh
homingbird desk pause --server https://<server>
homingbird desk resume --server https://<server>
```

Pausing stops every runner on this computer for you on that server, `homingbird run`, the background
service and `homingbird-mcp --run-agent`, before their next note: one in hand is finished, the rest
wait. Resuming answers what waited. Both can be run any number of times, and `homingbird status` shows
`Desk: paused`.

### Roll out to an organization

Administrators can install the command line and the service centrally, with MDM or an onboarding
script; see [Roll out to an organization](https://github.com/let-sunny/homingbird/blob/main/docs/deployment.md#roll-out-to-an-organization).
Signing in is never pre-provisioned: each person runs `homingbird login` once and approves the
connection in the browser.

## Approving is a person's action

A draft is sent only when its person approves it, in the web client (`homingbird open`), where they
signed in themself. The command line has no approve or discard command: the credential it stores is an
agent credential, and the server refuses it on every route that sends or discards.

Pre-releases are published under the `next` tag: `npm install -g @homingbird/cli@next`.

## More

- [Homingbird](https://github.com/let-sunny/homingbird#readme)
- [Guide: signing in, agents, approving](https://github.com/let-sunny/homingbird/blob/main/docs/guide.md)
- [Running a server](https://github.com/let-sunny/homingbird/blob/main/docs/deployment.md)
