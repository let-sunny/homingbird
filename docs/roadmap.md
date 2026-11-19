# Roadmap

What comes next, in order: this release (My agent, teaching with rules and stored answers, the agent
introduction, session health and the always-on runner), debate rooms, a UI and UX improvement stage, a
refactoring pass, a pilot with a real team, then answering on its own. Items marked **Built** are done;
everything else is not built yet. Open an issue to discuss one before starting.

## This release: My agent and an agent that is always on

**Built:** stored answers as a kind of item in the principles list (a fixed text, or an answer taken from
a source, still approved by a person); the agent introduction (a per-item Public toggle with a sentence
written for colleagues, shown in the people list); session health (each agent draft records its desk
session's age and, where the integration knows it, context use; My agent shows edit and discard rates by
session, and the mod pane and My agent → Connection suggest a fresh session); and the always-on runner
service. Still to come from this release:

- Context use for MCP desks is self-reported, like the model; measure it where an MCP host exposes it.
- The A2A gateway reports no session age or context use yet.

**Debate rooms** are built (below). The **UI and UX improvement** stage is **Built**: a character
appears only where it stands for a person or a page is empty (see decisions), Debates is a header tab
and the tabs form a grid on a phone, every main page has its loading and empty states and is checked at
390 px (`e2e/pages.e2e.ts`), the focus ring meets 3:1 in both schemes, and the long explanations are
shorter in English and Korean.

Then a **refactoring pass before the pilot**, with no new features: remove dead code and duplicated logic
left by renames and removals, split files that answer more than one question, give every source file its
same-named test (the lint warning list), run mutation tests on `kernel` and `protocol`, measure the
administrator Insights aggregation and the event fan-out at pilot size, and run the full live test again.

A pilot with a real team starts after that and before **answering on its own** (automatic sending and
judging its scope, described under "An agent that earns trust"); the numbers from that pilot decide
whether, and where, automatic sending opens.

## Debate rooms

**Built** as described below ([guide](guide.md#debate-rooms)). Still to come:

- **A short debate before answering alone.** An option for an agent, before it drafts an answer on its
  own, to hold a short debate with colleagues' agents and draft from the approved result. It waits for
  answering on its own, and the person still approves what is sent.
- Adding members to a private room after it is opened, and taking an agent out of a room.

A separate kind of room, not notes, where several people's agents discuss one question on their own for
a limited number of turns and produce one result. Open or private, like channels.

- **Not notes.** Messages in a debate room are agent turns, visible to the room's members, never
  delivered as notes and never leaving the room. Rule 1 stays true: nothing a person is accountable for
  is sent without them.
- **Opt-in per room.** Each participant's person opts their agent in for that room; an agent never joins
  by itself.
- **Limits are settings people choose:** maximum turns per agent and in total, a time limit and a length
  cap per turn. The room stops at the limit and asks for the result.
- **Turns are untrusted input.** Each agent reads the others' turns as quoted data from colleagues,
  through `wrapNote`. Agents in a debate run without action tools (read-only sources their person
  allowed; split mode recommended), and nothing in a turn can make an agent send, change contacts or
  touch credentials.
- **The result is a draft.** When the turns run out, the room always produces one of two results, and it
  leaves the room (to a channel, a direct message or a document) only when the people whose agents took
  part approve it, each in the web client:
  1. **A conclusion summary** when the agents agreed: the conclusion, the reasons, and what each
     participant contributed.
  2. **A "no conclusion" analysis** when they did not: where they disagreed and why, above all
     information asymmetry (which participant's agent had a fact, source or context another lacked,
     such as "Ana's agent read the March incident report; Ben's agent had no access to it"), differing
     assumptions or criteria, differing goals (participants optimising for different outcomes, such as
     "Ana's agent aimed to ship this week; Ben's agent aimed to avoid any customer-facing risk", which no
     amount of shared information resolves, so the next step is for the people to agree on the goal,
     not to share more), and open questions, with suggested next steps: who should share what, or which
     person must decide. It names what was missing by source or kind, and never quotes another
     person's private material beyond what was said in the room. Disagreement is shown per point, never
     as a single verdict.
- **One question, one room.** A debate room exists for one question, closes when it produces its result
  and becomes read-only; it is never reopened, and a new question is a new room.
- **Exportable.** A member can export the whole transcript and the result (the conclusion summary or the
  "no conclusion" analysis) as Markdown, and as JSON for tools, with participants named by display name.
  Exporting a private room is open to its members only and is recorded in the audit log.
- **Private rooms:** only members see the turns and the result; the audit log records everything, as
  elsewhere.
- **What growth rewards.** A good agent produces a conclusion and proposes next steps; it does not win
  arguments. The person's private growth record (the route map, milestones) credits an agent when its
  contributions end up in an approved conclusion, when it fills a gap another agent lacked, when it
  separates a disagreement into information, assumptions and goals, when it changes its position on
  better evidence, and when the people accept its proposed next steps. Never wins, debate counts, or
  rankings between people or agents.

## An agent that earns trust

**Teaching is the core direction: a person teaches their agent one route at a time. Automatic sending
comes only after the team pilot, and only inside a route a person opens, so that answers within it go
out under a principle the person saved, while everything outside it still waits on the approval card.** At first
every reply is approved, as in 0.1.0. What grows is never a global level: it is a **route**: a channel, or
a cluster of similar questions within it, so easy questions never earn trust for sensitive ones.
Without every constraint below, this is less safe than approving every note, so none of them is
optional.

**Built:** the **My agent** page with the person's figures, principles (saved by hand, or offered after a
substantial edit or a discard, with a suggestion made from the edit alone), the "Principle applied"
marker with "This principle was wrong here", per-principle counts, milestones, and a private route map
whose lines grow with what was taught in each channel, stored answers as items of the same list, and
public sentences for colleagues ([guide](guide.md#my-agent), security rule 8).
Still to come, below: principles offered from recurring similar answers and question clusters,
confidence per route, opening a route, and:

- **How colleagues' trust in an agent is measured**, for example how often an asker had to ask again.
- **Documents the agent always reads, turned into principles.** A person can hand their agent reference
  documents it should always consult (a release calendar, a policy, a handbook). Homingbird never feeds
  a whole document into every prompt: it proposes principles and stored answers drawn from it, each
  with the document as its source, and the person saves each one as with any principle (rule 8). This
  belongs with answering on its own, after the pilot: a route opened for automatic sending can rest on
  principles that came from such a document, and a change to the document offers updated principles
  rather than changing saved ones silently.

### The loop

1. **Collect.** Per channel and per asker, Homingbird keeps what people ask this person, with the drafts
   they sent unedited, edited, discarded or wrote by hand. This grants nothing; it shows the person what
   people ask them. The counts per channel are built (**My agent**); per asker and per question
   cluster are not.
2. **Make a principle.** (Built for edits and discards; not yet for recurring similar answers.) When
   similar answers recur, the product asks "Keep this as a principle?", and
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
  can read only the sources the person listed. The first half of this is built: the runner's split mode
  (`homingbird run --split`, `homingbird-mcp --run-agent … --split`) passes the drafting agent only a
  reader's checked fields, never the note. It stays a prerequisite for automatic sending, not a reason
  to start it: Homingbird cannot yet take tools away from an arbitrary agent command, and the drafting
  agent still reads whatever its tools reach.
- **Deciding whether a note falls inside the person's automatic scope is the critical logic**, and it
  has three layers. First, deterministic server boundaries: the channel, the sender, the hours,
  attachments and links, and the length; failing any one keeps the note on the approval card. Second,
  matching against the answers the person stored: this is the only layer that can say "inside". Third,
  a model check that may only demote a note to approval, never promote one. The default is outside.
  Every automatic send records which boundaries it passed and which stored answer matched, and a recall,
  or the person marking a send "this was outside", closes that route.
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

The first part is built: **My agent** for each person (a page in the header, per channel)
and organization-wide **Insights** for administrators, with groups under 5 people hidden
([guide](guide.md#see-how-far-you-can-trust-your-agent), [deployment](deployment.md#insights)). Still
to come:

- **Your week, beyond the agent**: notes sent, replies received and my median reply time on the card.
- **More for administrators**: decision time, the quick-approval rate with a warning when a team stays
  above a threshold (25% over 2 weeks, as settings), who wrote what was sent (`agent`, `human_edited`,
  `human`), and delivery health.
- **Teams**: an administrator creates teams and assigns members, by hand or from a CSV file; a
  Google Workspace directory import is optional, needs a read-only directory service account, and a
  value an administrator set wins over it; group sync arrives with SCIM. With no teams, only
  organization-wide numbers are shown, as now.
- **Privacy, binding for all of it:** numbers only, never note content. An administrator sees team
  totals, never one person's approval figures. Groups under 5 people are hidden. Blocks are a count,
  never who blocked whom. Every member can see the list of what is measured.

## Operations

- Multi-node deployment: shared event fan-out through the database or a message broker.
- Audit forwarding over syslog and OpenTelemetry.
- SCIM provisioning and periodic re-validation of members against the identity provider.
- Revoking a credential family when a refresh token is replayed.
- Supported upgrades between releases. The mechanism exists (a schema version table, with steps
  applied in order at start) and step 2 upgrades a 0.1.0 database, but upgrades between 0.x releases
  are not yet promised or tested release by release.

## Clients

- Presence for remote MCP connectors and long-poll clients.
- Connected versus awake for agents that cannot be woken: the web client and the guide already say an
  agent is "awake" only while its desk runs, and that a connected agent is not necessarily awake. Still
  to do: show a web connector that can never be woken as such in the directory, instead of as an agent
  that is merely asleep.
- Native desktop and mobile clients.
- Languages beyond English and Korean.
- The background service tested where it runs: the launchd agent on a Mac, the Run key entry and the
  runner's own supervision on Windows, and the systemd unit under a real user manager. Until then
  `homingbird service` documents macOS and Windows as generated output only.
- Agent presets verified with the real agents: Codex CLI, Antigravity CLI and Gemini CLI are listed as
  "from source, unrun" until run here. Codex's reader keeps minimal tools, and Antigravity and Gemini
  have no reader preset for split mode yet. When the agent supports MCP, the run
  attaches this Homingbird MCP server (member routes only) so the agent can find people and channels.
- Log rotation for the background service: its log grows a line per step until the person removes it.
- A service started without a credential tells the person, through a web banner or a notification,
  with a connection link; today `homingbird service status` says to sign in. Managed settings shipped
  with the organization's skills as a third way to roll out, next to MDM and onboarding scripts.
