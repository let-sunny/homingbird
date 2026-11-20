# Roadmap

What comes next, in order: this release (My agent, teaching with rules and stored answers, the agent
introduction, session health and the always-on runner), debate rooms, a UI and UX improvement stage, a
refactoring pass, groups and channel agents, the cloud desk, more insights, a pilot with a real team,
then answering on its own. Items marked **Built** are done;
everything else is not built yet. Open an issue to discuss one before starting.

## This release: My agent and an agent that is always on

**Built:** stored answers as a kind of item in the principles list (a fixed text, or an answer taken from
a source, still approved by a person); the agent introduction (a per-item Public toggle with a sentence
written for colleagues, shown in the people list); session health (each agent draft records its desk
session's age and, where the integration knows it, context use; My agent shows edit and discard rates by
session, and the plugin pane and My agent → Connection suggest a fresh session); and the always-on runner
service. Still to come from this release:

- Context use for MCP desks is self-reported, like the model; measure it where an MCP host exposes it.
- The A2A gateway reports no session age or context use yet.

**Debate rooms** are built (below). The **UI and UX improvement** stage is **Built**: a character
appears only where it stands for a person or a page is empty (see decisions), Debates is a header tab
and the tabs form a grid on a phone, every main page has its loading and empty states and is checked at
390 px (`e2e/pages.e2e.ts`), the focus ring meets 3:1 in both schemes, and the long explanations are
shorter in English and Korean.

The **refactoring pass** is **Built** (0.2.0): dead code and duplicated logic are gone, every source file has
its same-named test, `kernel` and `protocol` pass mutation tests, and the administrator Insights
aggregation and the event fan-out were measured at pilot size (every call under 500 ms, see
`scripts/pilot-measure.ts`). The full live test on macOS and Windows runs again on 0.2.0.

Next come **groups and channel agents** (groups are built), then **the cloud desk** (a desk woken through a URL a
person registers; a first version is built, below), then **more insights** (per group and per channel agent). A pilot with a
real team starts after that and before **answering on its own** (automatic sending and
judging its scope, described under "An agent that earns trust"); the numbers from that pilot decide
whether, and where, automatic sending opens.

## Debate rooms

**Built** as described below ([guide](guide.md#debate-rooms)), with the result settled by the agents'
vote among their drafts, a room that never waits for an agent that dropped out and closes with one
agent left, a grace chosen at setup, limits fixed once the debate starts, private rooms readable by an
administrator as a person, as private channels are, and exports in the exporting person's language.
Still to come:

- **A short debate before answering alone.** An option for an agent, before it drafts an answer on its
  own, to hold a short debate with colleagues' agents and draft from the settled result. It waits for
  answering on its own, and the person still approves what is sent.
- Adding members to a private room after it is opened, and taking an agent out of a room.

A separate kind of room, not notes, where several people's agents discuss one question on their own for
a limited number of turns and produce one result. Open or private, like channels.

- **Not notes.** Messages in a debate room are agent turns, visible to the room's members, never
  delivered as notes and never leaving the room. Rule 1 stays true: nothing a person is accountable for
  is sent without them.
- **Opt-in per room.** Each participant's person opts their agent in for that room; an agent never joins
  by itself.
- **Limits are settings people choose** at setup, before the first turn: maximum turns per agent and in
  total, a time limit, a length cap per turn, and the grace after which an unseen agent drops out (5,
  10 or 30 minutes). The room stops at the limit and asks for the result.
- **Turns are untrusted input.** Each agent reads the others' turns as quoted data from colleagues,
  through `wrapNote`. Agents in a debate run without action tools (read-only sources their person
  allowed; split mode recommended), and nothing in a turn can make an agent send, change contacts or
  touch credentials.
- **The agents settle the result; a person takes it out.** When the turns run out, the agents draft and
  vote, and the room always produces one of two results. It leaves the room only through a person: a
  person whose agent took a turn posts it to a channel or a direct message as a draft of theirs, which
  they send, or a member exports the closed room:
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
  Exporting a private room is open to its members only and is recorded in the audit trail.
- **Private rooms:** only members see the turns and the result, and administrators when they sign in
  themselves, as with private channels; the audit trail records that the room was opened and exported,
  never its content.
- **What growth rewards.** A good agent produces a conclusion and proposes next steps; it does not win
  arguments. The person's private growth record (the route map, milestones) credits an agent when its
  contributions end up in a settled conclusion, when it fills a gap another agent lacked, when it
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

**Built:** a deep link to each draft's card (`#/c/<conversation>?draft=<id>`), used by the draft
notification, the desk pane's **Open in web**, `homingbird open <draft id>` and the MCP tools, with no
new server route: the link only opens the web client, where the person signed in themself and approves
there ([guide](guide.md#turn-on-phone-notifications)).

- Confirmation on another device: the desk asks, and the person confirms on a second device. It needs
  proof of which device confirmed, such as a WebAuthn assertion, because the server cannot tell one
  signed-in browser from another, and an "ask my phone" route a model could call would ring a person's
  phone at will. It waits for pilot demand; approval in the plugin was removed in 0.1.0 because a
  credential stored next to the agent cannot be protected.
- A review request in the chat tool the team already uses: a Slack or similar notification that only
  links to the draft's card. Approval stays in the web client; the message carries no note content.
- A warning on the approval card when a draft drew on a private place (a private channel, a private
  question, a private debate room) and goes somewhere with more readers. A warning, not a block: the
  person approving decides. The drafting flow records which conversations it read.

## Messaging

**Built:** starting a conversation with several people in the web client: People offers **Add to group
message** on every card one may message, the people chosen show as removable chips, and
**Start group message** opens the group room, where the first note is written or drafted and approved as
in a direct conversation ([guide](guide.md#ask-a-person)). When a group room with exactly those
people exists, People opens it instead.

**Built:** muting a direct message or a channel, which keeps its notes and unread count but sends the
person no notification, and a level for device notifications: every direct message and channel, direct
messages only, or nothing ([guide](guide.md#turn-on-phone-notifications)).

- Hiding a new group message from its other members until a note in it is sent, as a direct message is
  hidden. Today everyone chosen sees the empty room at once, and a room whose only draft was discarded
  stays in their list. This changes what `conversations.list` returns, so it waits for a decision.
- Naming a group message from the web client. The API accepts a title, but everyone in the room sees
  it as soon as the room is made, before any note is approved, so the web client leaves it unnamed.
- Attachments. Notes are text and links only by design.
- Answering flows per channel: a channel adds its own steps to the server's answering flow, with the trust
  questions that raises (who may write them, and how members see what applies).
- Command steps for the runner: `homingbird run` runs commands a person names before drafting and as
  checks on the draft, passing their output to the agent as quoted data.
- Why a channel is or is not visible: for a person, the reason their access rests on (a member, a
  manager through a group, an administrator seeing that it exists), so "why can't I see it" has an
  answer without asking an administrator. The policy returns a tagged reason instead of a boolean.

## Groups and channel agents

For a team that answers questions from its own knowledge, such as a wiki kept in a repository: one
channel per repository, and one agent the channel owns, drafting from that repository. In this order:

1. **Groups.** **Built** ([guide](guide.md#groups), [decisions](decisions.md#groups-replace-channel-managers)):
   teams, made and named by an administrator, and each channel's own group of managers, which the
   upgrade made from each channel's managers. An administrator fills teams by hand or from a CSV file;
   groups come from nowhere else (no directory import, no SCIM). Every member sees the teams and who is
   in them; a channel's group shows only where its channel does. A channel's managers add a team's
   people to theirs once, with no link kept. A person's profile shows their teams and the channels they
   manage; a team's page shows its members; the people list filters by team. Changing a group is a
   person's action (`access: 'human'`), never a model's tool, and deactivating a member removes them
   from every group at once. What a person may approve on their profile ("approves answers for
   #payments-wiki"), and a group's agents on its page, come with item 2.
   Later: a version check on group member lists so a stale page cannot overwrite a concurrent change,
   and paged group lists.
2. **An agent owned by a group.** **Built** for a channel's agent ([guide](guide.md#a-channels-agent),
   [decisions](decisions.md#a-channels-agent-is-its-own-member-and-its-channels-managers-approve-it)),
   without taking a draft. An agent's owner becomes a group of approvers: a person's own agent
   is a group of one; a channel's agent is owned by the channel's managers. Its drafts are visible only
   to that group, never to the person who asked. Any one member approves, and the first approval wins;
   the others see who already sent it, and a member can take a draft ("I'll look at this"). A sent
   note shows the agent and its approver ("#payments-wiki · approved by @kim"), and the audit trail
   records the approver. Approval stays a person's act. Later: taking a draft ("I'll look at this"),
   a person's own agent as a group of one, and a manager's approvals on their profile.
3. **Asking a channel's agent privately.** **Built** ([guide](guide.md#a-channels-agent)). A sensitive question goes to the channel's agent as a direct
   conversation: the asker sees only their own conversation, and its first screen says that the
   channel's managers see it too, because they take part in it.
4. **Where to ask**: the list of channel descriptions tells people which channel to ask, rather than an
   agent that forwards questions, which would need an approval at every hop. A question asked in the
   wrong place is moved with the existing move.

5. **Decision rules.** One rule says who decides, how many of them must agree, and what is decided:
   a group, a number, and either sending a draft or settling a proposal in a channel. One approver is
   today's approval; two approvers is a stricter rule for a group's agent. In a channel room, members
   mark a note "agree" or "disagree", everyone in the room sees who did, with their characters and
   names, and when the channel's rule is met the note is marked settled and the room is told. An
   agent may propose its person's mark, with a reason, as a draft; it counts only once the person
   confirms it. Every decision is a person's act, like approving a note: no tool exposed to a model can
   cast one, for the reason behind security rule 3, or agents could settle what no person saw. Letting
   an agent decide without its person would be a deliberate relaxation needing a delegation the person
   scopes, an organization setting that is off by default, an audit entry for every delegated
   decision, and results that show delegated decisions apart from people's. A debate's result stays
   the agents' vote, outside these rules.

6. **Recommended sources per channel**: a channel names the sources its answerers should consult
   first, such as a wiki space or a runbook, passed to answering agents as guidance, never as
   instructions.
7. **Basis as links**: what an agent relied on for a draft names its sources as links its person and an
   administrator can open, not only as text.
8. **Whose questions a channel agent answers**: the agent stays running, and its managers narrow whose
   questions it drafts an answer to (everyone in the channel, a list of people, or managers only), so a
   question from anyone else never reaches the model at all, a defence next to quoting it with
   `wrapNote`.

Later: mentioning a group, private groups.

Later: **channel agents asking each other**, once groups, group-owned agents and the runner exist. A
channel's agent that needs another team's knowledge, such as the payments wiki's agent needing
infrastructure detail, sends a question to that team's channel. The sending channel's managers
approve the question and the receiving channel's managers approve the answer, so approval stays a
person's act (security rule 1) and drafts stay invisible to recipients (rule 2). The final answer
shows who confirmed it ("#infrastructure-wiki · confirmed by @park, #payments-wiki · approved by
@kim"). Teams pass confirmed answers rather than repositories or documents. A note received this way
reaches a model wrapped by `wrapNote` (rule 4). When agents go back and forth more than a set number
of times without a person taking part, the conversation stops and the managers are told. An agent
talking to another agent of the same owner gets no exemption from approval.

## The cloud desk

A desk that runs in a cloud agent service instead of on a person's computer, woken when work arrives.
Experimental, behind a feature switch that is off by default.

**Built** as a first version ([guide](guide.md#wake-a-cloud-desk), [deployment](deployment.md#cloud-desk),
decisions): one wake per person, sealed with `HB_SECRETS_KEY`, to hosts in `HB_WAKE_HOSTS`; the Claude
routine preset first, then a generic POST; gathering, spacing, backoff, stop and notice, and the debate
re-wake. Still to come:

- **Test the Claude routine preset with the real service**, and a preset for each further service that
  offers an HTTP trigger.
- **Rotating `HB_SECRETS_KEY`**: a command that opens every wake with the old key and seals it with the
  new one. Today a new key means everyone sets up again.
- **More than one wake per person**, and a wake for a channel's agent.
- **Wakes across instances**: the pending wakes and presence are in memory, like the rest of
  [one instance](deployment.md#one-instance-only).
- **Remove a wake from the web client while the feature is off**: the route works, but the page hides
  the section.

- **A wake URL.** A person registers a URL and a token in the web client. When notes, debate turns or
  votes wait for their agent, Dovecote sends a request to that URL carrying only that there is work and
  the server's address, never a note; the woken session reads everything through the Homingbird
  connector. Work arriving close together is woken once, and a room the agent takes part in is woken
  again before its grace runs out. A refused or unanswered wake is shown to the person and retried.
- **Setup helpers, not server code.** The web client offers presets that fill in the URL format and
  headers and show a prompt to paste into the woken task: first a Claude routine (its API trigger,
  whose token can only start that task), then a generic "POST this URL with this header". A token that
  can do more than wake (a Cursor or Devin key) is accepted with a warning.
- **The token** is stored encrypted, used only in the wake request, never shown again, and deleted
  when the person removes it (security rule 5).
- Not yet possible: Codex cloud, ChatGPT tasks and the Gemini app offer no HTTP trigger; revisit when
  they do.

## Insights

The first part is built: **My agent** for each person (a page in the header, per channel)
and organization-wide **Insights** for administrators, with groups under 5 people hidden
([guide](guide.md#see-how-far-you-can-trust-your-agent), [deployment](deployment.md#insights)).
**Built:** **Your week** at the top of How it is doing (notes sent, replies received, typical reply
time); for administrators, organization-wide, the typical decision time, who wrote what was sent
(`agent`, `human_edited`, `human`), delivery to agents, and quick approvals week by week with a warning
at 25% for 2 weeks; and **What is measured**, a page every member can open, with a test that fails for a
figure it does not name. Still to come:

- **Quick-approval warning per team, and as settings**: the 25% and 2 weeks are constants today
  (`QUICK_APPROVAL_SHARE`, `QUICK_WARNING_WEEKS` in `protocol`), organization-wide only.
- **Numbers per group**: insights show figures per group (see "Groups and channel agents"), still
  hiding groups under 5 people; with no groups, only organization-wide numbers are shown, as now.
- **Channel agents**: per channel, how often its agent's drafts are approved, how often after an edit,
  and how many each manager approved.
- **Privacy, binding for all of it:** numbers only, never note content. An administrator sees team
  totals, never one person's approval figures. Groups under 5 people are hidden. Blocks are a count,
  never who blocked whom.

## Operations

**Built:** `scripts/check-style.ts` refuses writes to `audit_events` outside
`dovecote/src/domain/audit.ts`, and stdout or console output outside the log service and the programs
whose stdout is their output. Supported upgrades between releases: a database any final release left
starts on every later release, on SQLite, PostgreSQL and MySQL, tested in CI from a fixture per release
built through the real schema steps, and a release without a fixture does not ship. Still to come:

- Multi-node deployment: shared event fan-out through the database or a message broker.
- Forwarding the metadata-only audit copy over syslog and OpenTelemetry, and an OCSF mapping for
  `dovecote audit export`.
- A compliance export of the product's own data (notes, drafts, debate rooms) for legal hold, if an
  organization asks for one: not the audit trail's job.
- Periodic re-validation of members against the identity provider.
- Revoking a credential family when a refresh token is replayed.
- Cloud desk wakes in parallel: the pass sends them one after another, so a slow wake service (up to
  its 10-second timeout) can delay other people's wakes; consider a small cap on concurrent wakes.

## Clients

**Built:** log rotation for the background service (5 MB, one backup, and `--log-level`); headless
sign-in with a credentials file (`homingbird login --credentials-file` on the person's own machine,
`--credentials-file` or `HOMINGBIRD_CREDENTIALS_FILE` for the runner and `homingbird service install`,
with a complete server example in the deployment guide); the launchd service on macOS, installed and
run on a real Mac by the maintainer for 0.1.3; desktop CI, which runs the command line and MCP
tests on macOS and Windows, and there installs the real launchd agent and Run key entry, has each
answer a note and removes it; and a banner on **My agent**, **Connection** while none of the person's
agent credentials can be used, with the sign-in command for that server and a link to enter its
connection code, while `service install` and `service status` print the exact command that ends the
service's wait, credentials file included.
Still to come:

- Presence for remote MCP connectors and long-poll clients.
- Connected versus awake for agents that cannot be woken: the web client and the guide already say an
  agent is "awake" only while its desk runs, and that a connected agent is not necessarily awake. Still
  to do: show a web connector that can never be woken as such in the directory, instead of as an agent
  that is merely asleep.
- Native desktop and mobile clients.
- Languages beyond English and Korean.
- The background service tested where it is still untested: the Run key entry and the runner's own
  supervision on a real Windows machine, and the systemd unit under a real user manager.
- Agent presets verified with the real agents. Built: version checks with a minimum version per preset,
  Claude Code without the person's hooks and with `--permission-prompts none`, its reader past a managed
  MCP configuration, a Codex reader with every listed MCP server switched off, Antigravity in its stream
  format with a reader and a sign-in check, and `run --attach-mcp`. Checked here only against Claude
  Code 2.1.329's `--help`; still to do: run Codex CLI, Antigravity CLI and Gemini CLI with each preset
  (agent, reader, `--attach-mcp`), check the wording of Claude Code's managed-configuration refusal,
  whether Codex reads `-c mcp_servers."name".enabled=false` and takes `--ignore-user-config` before
  `mcp list`, and whether `--ignore-user-config` alone already leaves the person's MCP servers out (then
  drop the probe and the switches), then mark each preset verified and turn
  `--attach-mcp` on by default where it worked. Gemini has no reader preset, and its exit codes are
  shown as numbers until their meaning is checked. Codex's `--ask-for-approval never` is not added until
  its `--help` shows it.
- `--attach-mcp` for the background service, and an MCP attach for Antigravity once its settings name
  a way to add a server for one run.
- Reading Claude Code's stream-json output, to report the tools it denied (`permission_denials`, by
  name only) as the reason a draft is partial.
- Managed settings shipped with the organization's skills as a third way to roll out, next to MDM and
  onboarding scripts.
- `homingbird wait`: send a note and wait for its reply in one command, with an explicit timeout
  and an exit code that tells a timeout from a reply, for agents that have a shell but no MCP.
- The command line as complete as the MCP tools for agents: `--json` on every command, and each
  failure naming its reason and the next step to take, derived from the tagged failures.
- A getting-started guide written for the agent to read: read the channel's norms first, answer in the
  existing thread, lead with the conclusion. The plugin and every agent preset point at the same file.
- Several agents per person (a Claude desk and a Codex reader at once): each draft names the agent
  that wrote it, for display and for insights per agent, never for permissions; check that two
  desks do not pick up the same note twice.

## The pilot

What to measure and watch while a real team uses Homingbird, before answering on its own:

- Approval load: approvals per person per day and the time a draft waits. Approving every note is the
  product's promise and its likeliest bottleneck.
- Whether notes become task requests: if people start asking "who took this" and "is it done", a
  taken and done mark on a note may be needed. A task queue stays out of scope.
- Agents that are not awake: how often a note waits because the person's desk was closed, and whether
  the runner or the cloud desk closes that gap.

Before the pilot, for an organization's security review, **Built**:

- A tamper-evident audit trail: each audit entry carries a hash of the one before, and
  `dovecote audit verify` checks the chain. The documentation says plainly that this detects changes
  and does not prevent them: whoever can write the database can recompute the chain
  ([deployment](deployment.md#the-audit-trail), [`SECURITY.md`](../SECURITY.md)).
- Deactivating a person stops all of their credentials at once, refreshing and sign-ins approved but
  not yet collected included, stated in the guide and held by its own test
  ([deployment](deployment.md#when-someone-leaves)).
- A "works today, still being wired up, not planned" table in the README, and the outside services a
  deployment needs in the deployment guide: one, an OpenID Connect identity provider
  ([deployment](deployment.md#outside-services)).

Still to come here: signing the chain head with a key the database's writers lack, if an organization
asks for it (see decisions).

Ideas noted and not planned: structured notes validated against a registered schema, and syncing
channels with an outside chat tool (only approved notes would leave, and anything coming in would be
wrapped like any note).
