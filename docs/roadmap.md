# Roadmap

Ideas that are outside the current brief. Nothing here is built. Open an issue to discuss one before
starting.

## Messaging

- Starting a group conversation with several people in the web client. The API accepts several
  participants, and the web client shows group and topic rooms, but its composer starts a
  conversation with one person.
- Attachments. Notes are text and links only by design.
- Per-conversation mute and notification preferences.
- Muting a topic: staying in a room without its notifications, short of turning answering off.
- An intake mode for private topics, where people outside the topic submit a question and see only
  their own thread, for teams such as payroll or security that take questions from everyone.
- Recommended sources per topic: a topic names the sources its answerers should consult first, such
  as a wiki space or a runbook, passed to answering agents as guidance, never as instructions.
- Basis as links: the audit record of what an agent relied on for a draft names its sources as links
  an administrator can open, not only as text.
- Answering flows per topic: a topic adds its own steps to the server's answering flow, with the trust
  questions that raises (who may write them, and how members see what applies).
- Personal answering flows: a person adds steps of their own, kept on their machine, to the ones the
  administrator set.
- Command steps for the runner: `homingbird run` runs commands a person names before drafting and as
  checks on the draft, passing their output to the agent as quoted data.

## Agreeing in topic rooms

- Marks: members of a topic room mark a note "agree" or "disagree", and everyone in the room sees who
  did, with their characters and names. An agent may propose its person's position, with a reason, as
  a draft; the mark counts only once the person confirms it.
- Settling: a topic manager sets a threshold for a topic or for one proposal, such as three
  agreements. When it is reached the note is marked settled and the room is told.
- A mark is a person's act, like approving a note: no tool exposed to a model can cast one, for the
  reason behind security rule 3, or agents could settle what no person saw. Letting an agent mark
  without its person would be a deliberate relaxation, and would need a delegation the person scopes
  (which topic, which kind of proposal), an organization setting that is off by default like
  `HB_APPROVE_BUTTON`, an audit entry for every delegated mark, and results that show delegated marks
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
- Native desktop and mobile clients.
- Languages beyond English and Korean.
- Runner as a background service, after 0.1.0: one command (working name `homingbird service
  install`, with `status` and `uninstall`) registers `homingbird run --agent "<command>"` to start when
  the person logs in and restart if it stops, with launchd on macOS, a systemd user service on Linux
  and Task Scheduler on Windows. Nobody has to keep a session open, and the web client is all a person
  uses. It runs as the person, never as root or system-wide; it uses the saved agent credential only,
  so it can draft and skip but never approve; it is written with the platforms' own files and no new
  dependency; its logs carry no note content or tokens; and an organization can ship it together with
  its skills. Unlike the mod, each note starts a fresh agent run with the tools that command loads,
  not the person's interactive session.
