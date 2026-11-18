# Roadmap

Ideas that are outside the current brief. Nothing here is built. Open an issue to discuss one before
starting.

## An agent that earns trust

**The main direction after 0.1.0, once a pilot has measured approval fatigue: a person teaches their
agent one route at a time, and may later open a route so that answers within it go out under a
principle the person saved, while everything outside it still waits on the approval card.** At first
every reply is approved, as in 0.1.0. What grows is never a global level: it is a **route**: a channel, or
a cluster of similar questions within it, so easy questions never earn trust for sensitive ones.
Without every constraint below, this is less safe than approving every note, so none of them is
optional.

### The loop

1. **Collect.** Per channel and per asker, Homingbird keeps what people ask this person, with the drafts
   they sent unedited, edited, discarded or wrote by hand. This grants nothing; it shows the person what
   people ask them.
2. **Make a principle.** When similar answers recur, the product asks "Keep this as a principle?", and
   the person confirms the sentence and saves it. Only a person's click saves or changes a principle,
   the same rule as profile characters, and it becomes a security rule with its own test; no
   model-facing tool can add or change one. A principle is the person's own standing instruction for
   that route: this is the personal answering flow, which is why that idea no longer has an entry of
   its own.
3. **Confidence per route.** The server computes it from what happened, never from a confidence the
   model reports about itself: the share of drafts in that route sent unedited, the share discarded,
   and the share where the asker had to ask again.
4. **Opening the door.** A full gauge sends nothing by itself. The person opens that route explicitly;
   questions outside it stay on the approval card. A correction, a recall or closing the door lowers
   only that route. Closing a route is built before any number is shown.

### How it feels

- The person's character is what grows on screen, and it grows from what it was taught, never from how
  much was sent. Each saved principle is something the character keeps (a working idea: a feather, or a
  piece of a route map that fills in as routes are learned); a learned route appears on the character's
  map of routes; its look may gain details as principles and routes accumulate. There is no single
  global level, and nothing about the character unlocks sending: opening a route stays the person's
  explicit act.
- Achievements reward teaching and supervising: the first principle saved; a draft corrected and the
  correction kept as a principle; a route with its first ten answered questions; a wrong automatic
  answer recalled and its route closed; a week with no reply approved in under a few seconds.
- Collections are private to the person by default. Nothing is compared across colleagues, and an
  administrator sees none of it, under the same privacy rules as Insights.

### What we will not build

Approval streaks, points or counts of notes sent, rewards for speed, rankings between people or of
automatic answers, and a character that changes with how much was sent: they reward not reading. Any
celebration is for a principle being saved, never for sending.

### Constraints that make it safe

- **A delegation, not a reward.** Automatic sending is off by default for the server; the organization
  allows it before any person can open a route. It is scoped: one channel, one question cluster, given
  hours, and only when the route's principle applies. Trust is set per person and per channel through a
  human-only route, and private channels have no door at all.
- **The first automatic step re-sends only an answer the person already approved, to a question in the
  same channel room, so the audience is the same.** It never sends newly composed content and never to a
  different audience.
- **A controlled runner before anything newly composed goes out unapproved.** It works only in a runner
  where Homingbird controls the tools, never an interactive session whose agent has other tools,
  because the server cannot verify what a free agent read. The model that reads an incoming note has
  no tools and only extracts the question; the model that looks things up never sees the note text and
  can read only the sources the person listed.
- **Deterministic server-side checks decide, never a model**: secret patterns, a length cap, no
  attachments and per-recipient rate limits. Any hit demotes the answer to the approval card. Questions
  are not exempt: an injected agent can put anything in a "question".
- **Visible and undoable.** A note sent this way is marked as sent without a person's review, distinctly
  from `agent`, so a recipient never assumes a person saw it. The person sees a list of what was just
  sent alone, can recall within an undo window and close the route in one action, and gets a daily
  digest. Everything is audited.
- **The security rules and their tests change with it**, rules 1 and 3 above all, only by an explicit
  maintainer decision.

## Approving

- Approve from the desk, confirmed on another device: the desk pane asks, and the person confirms on a
  device where they signed in themself, by a push notification or the web client. Approval in the mod
  was removed in 0.1.0 because a credential stored next to the agent cannot be protected; this is the
  possible way back, with the credential never on the agent's machine.

## Messaging

- Starting a group conversation with several people in the web client. The API accepts several
  participants, and the web client shows group and channel rooms, but its composer starts a
  conversation with one person.
- Attachments. Notes are text and links only by design.
- Per-conversation mute and notification preferences.
- Muting a channel: staying in a room without its notifications, short of turning answering off.
- An intake mode for private channels, where people outside the channel submit a question and see only
  their own thread, for teams such as payroll or security that take questions from everyone.
- Recommended sources per channel: a channel names the sources its answerers should consult first, such
  as a wiki space or a runbook, passed to answering agents as guidance, never as instructions.
- Basis as links: what an agent relied on for a draft names its sources as links its person and an
  administrator can open, not only as text.
- Answering flows per channel: a channel adds its own steps to the server's answering flow, with the trust
  questions that raises (who may write them, and how members see what applies).
- Command steps for the runner: `homingbird run` runs commands a person names before drafting and as
  checks on the draft, passing their output to the agent as quoted data.

## Agreeing in channel rooms

- Marks: members of a channel room mark a note "agree" or "disagree", and everyone in the room sees who
  did, with their characters and names. An agent may propose its person's position, with a reason, as
  a draft; the mark counts only once the person confirms it.
- Settling: a channel manager sets a threshold for a channel or for one proposal, such as three
  agreements. When it is reached the note is marked settled and the room is told.
- A mark is a person's act, like approving a note: no tool exposed to a model can cast one, for the
  reason behind security rule 3, or agents could settle what no person saw. Letting an agent mark
  without its person would be a deliberate relaxation, and would need a delegation the person scopes
  (which channel, which kind of proposal), an organization setting that is off by default, an audit entry for every delegated mark, and results that show delegated marks
  apart from people's.

## Insights

After 0.1.0: numbers that let a pilot see whether people use Homingbird and whether approval is
becoming a formality, without exposing anyone's notes or one person's approvals to an administrator.

- **Your week**, for each person: a small summary card above the conversation list on the notes page,
  which folds away and never replaces the list. Notes sent, replies received, my median reply time,
  how I approved (sent as written, edited, discarded), how long I take to decide, and how often I
  approved within seconds, with a nudge when that is often.
- **Insights**, for administrators, in the admin area: active members, notes per active member, reply
  rate and median time to first reply, the approval mix, decision time, the quick-approval rate with a
  warning when a team stays above the threshold, who wrote what was sent (`agent`, `human_edited`,
  `human`), delivery health, and the number of blocks.
- **Teams**: an administrator creates teams and assigns members, by hand or from a CSV file; a
  Google Workspace directory import is optional, needs a read-only directory service account, and a
  value an administrator set wins over it; group sync arrives with SCIM. With no teams, only
  organization-wide numbers are shown.
- **Privacy, binding:** numbers only, never note content. An administrator sees team totals, never
  one person's approval figures. Groups under 5 people are hidden. Blocks are a count, never who
  blocked whom. Every member can see the list of what is measured.
- **Needs:** recording when a draft is first shown to its person, to measure decision time and quick
  approvals; aggregation on the server, with routes that return totals only (`admin` access for
  Insights, the member themself for Your week); and the thresholds (3 seconds for a quick approval,
  25% for the warning, over 2 weeks, groups of at least 5 people) as settings.

## Operations

- Multi-node deployment: shared event fan-out through the database or a message broker.
- Audit forwarding over syslog and OpenTelemetry.
- SCIM provisioning and periodic re-validation of members against the identity provider.
- Revoking a credential family when a refresh token is replayed.
- Supported upgrades between releases. The mechanism exists (a schema version table, with steps
  applied in order at start), but there are no migrations after the 0.1.0 baseline yet, and upgrades
  between 0.x releases are not promised.

## Clients

- Presence for remote MCP connectors and long-poll clients.
- Connected versus awake for agents that cannot be woken: the web client and the guide already say an
  agent is "awake" only while its desk runs, and that a connected agent is not necessarily awake. Still
  to do: show a web connector that can never be woken as such in the directory, instead of as an agent
  that is merely asleep.
- Native desktop and mobile clients.
- Languages beyond English and Korean.
- Runner as a background service, after 0.1.0: one command (working name `homingbird service
  install --server <url> --agent "<command>" [--workdir <dir>]`, with `status` and `uninstall`)
  registers `homingbird run` to start when the person logs in and restart if it stops, with launchd on
  macOS, a systemd user service on Linux and Task Scheduler on Windows. Nobody has to keep a session
  open, and the web client is all a person uses. It runs as the person, never as root or system-wide;
  it uses that server's saved agent credential only, so it can draft and skip but never approve; it is
  written with the platforms' own files and no new dependency; and its logs carry no note content or
  tokens. Unlike the mod, each note starts a fresh agent run with the tools that command loads, not
  the person's interactive session. Windows is untested today.
- Agent presets for the runner: `homingbird run --agent claude|codex|gemini` resolves to a verified
  command and options. A preset is listed as verified only after it is tested with the real agent.
  When the agent supports MCP, the run attaches this Homingbird MCP server (member routes only) so the
  agent can find people and channels.
- Organization rollout: installation and registration are done centrally, through MDM such as Jamf
  or Intune, an onboarding script, or managed settings shipped with the organization's skills: `npm
  install -g @homingbird/cli`, then `homingbird service install --server <url> --agent "<command>"`.
  Signing in is never pre-provisioned: each person approves their own connection once in the browser,
  because credentials are per person so that the audit log and offboarding stay meaningful. A service
  started without a credential tells the person, through a web banner or a notification, with a
  connection link. The deployment docs will carry example scripts for macOS, Windows and Linux; Windows
  is untested today.
