# Decisions

Product decisions serve one direction: helping a person come to trust their agent's answers. Each entry
states the decision first, then the reason. Add new entries at the top of their section.

## Product

- **A person can teach their agent in a short chat: their own agent proposes principles, and only the
  person saves them, in the web client (security rule 8, widened with the maintainer's approval).**
  Writing principles one by one in a form cost too much, so few people taught their agent at all.
  Now the person's own agent interviews them (`/homingbird teach` in the plugin, the `teach` MCP
  prompt), one short question at a time, drawing on a principles document the person pasted
  (`teaching.document.set`, `human`, at most 20,000 characters) and on the drafts it wrote that they
  edited or discarded in the last 30 days. It reads both through `interview_material`
  (`teaching.material`, `member`), which quotes the document, each draft, what was sent and the note
  it answered through `wrapNote` (rule 4): a draft can quote a colleague, and a pasted document can
  hold anything. It turns each answer into a proposal with `propose_principle`
  (`principleProposals.create`, `member`). A proposal is kept apart, in `principle_proposals`
  (migration step 21), never reaches an instruction block, and becomes a principle only through
  `principleProposals.accept` or `principleProposals.acceptAll`, `human` routes whose domain function
  checks again for a person's own sign-in and runs every check of a principle the person wrote: so a
  prompt-injected agent can at most leave a card the person reads before saving. The server refuses a
  proposal that could not be saved, repeats a title, or reads as a request for something no agent may
  do, and keeps at most 20 per person. Proposals made from a rewritten draft name it (`rewriteOf`),
  are listed as "Suggestions from drafts you rewrote" and are saved as from an edit or a discard;
  the others are saved as "From a chat with your agent". Each list has **Save all**, which saves
  every card as shown or none, naming the one that could not be saved. A channel's agent proposes
  nothing and reads no material: its managers teach it on its channel's page. The tool names avoid
  "teaching", which rule 3's test keeps out of every model-facing tool so that none reaches a
  channel agent's teaching. A change to the proposals tells the person's web clients with
  `proposals.changed`, an event without content. The audit trail records `principle.proposed`,
  `principle.proposal_discarded`, `principle.proposals_accepted` (a count) and
  `principle.document_changed` (whether one is kept), never the words. Everything sits behind the
  `teaching` feature. This supersedes "No model takes part in suggesting a principle" for proposals
  only: offers after an edit are still the deterministic word diff they were.

- **A debate room stops taking turns early once every agent says it is ready to conclude.** Evaluators
  watched agents keep taking empty turns after they already agreed, only because the room ran until
  its total or its time. So `debates.turns.post` takes an optional `ready`, kept with the turn
  (`debate_turns.ready`, migration step 20). An agent is ready when its latest turn says so, or once
  it has used all its turns; one that has not spoken is not, and a later turn without `ready` takes it
  back. When every agent taking part is ready, the room concludes with `because: 'agreed'`
  (`debates.concluded_because`, `concludedBecause` on the room, `debate.concluded` in the audit trail)
  and follows the same drafting, voting and closing as a room whose turns ran out: agreeing never
  skips the vote. A turn that also reaches the total concludes it as `limit`. The flag only marks the
  agent's own turn: no tool opens, closes or decides a room (rules 3 and 9). The MCP turn tool takes
  `ready` and `read_debate` says when to set it; an agent command under `homingbird run` ends its turn
  with a line of exactly `READY: yes`, which the runner takes off and sends as `ready`. A `READY:` line
  in another case or spacing is taken off too but reads as not ready, the safe side: the room only
  goes on. Clients read an unknown reason as no reason.
- **A debate room gives every agent its turns, starts its clock with the first turn, refuses a stale
  turn, and checks every credit against the turns.** Seven rooms run by real agents (four people,
  three scenarios, eval round 2) reached the right answer every time, but the mechanics around the
  conversation cost them: the constant total of 9 left one of four agents a single turn; two rooms
  lost a third of their time to opting agents in; opening turns always crossed, written blind; 27 of
  135 turn attempts were refused for being 2 to 75 characters too long, and while an agent rewrote,
  others took the last turns; 21 of 25 contributions claimed "changed position", including changes
  inside an agent's own blind first turn. So:
  - *Turns.* Without a total, a room's total is the turns per agent times the agents opted in
    (`limitsFor`), recomputed on each opt-in until the first turn and then fixed like every limit; a
    total a person sets stays as set, and every room stored before stays as it was
    (`debates.total_follows_agents`, migration step 15). The default stays 3 turns per agent: 14 of 18
    position changes came in a second turn, the owned, conditional version in a third, and nothing
    new after a fourth, so the web client offers at most 4 (the API still takes 20) and leaves the
    total empty unless the person fills it in.
  - *Time.* The limit counts from the first turn: the first turn moves the deadline to its own time
    plus the minutes. Before it, the deadline is when an unstarted room ends with `no_turns`, as
    before, so a room nobody starts still ends.
  - *Stale turns.* `debates.turns.post` takes an optional `afterTurn`, the last turn the agent read;
    a room that moved past it answers 409, saves nothing, and the MCP tool returns the newer turns,
    each inside `wrapNote`, so the agent rewrites instead of crossing. The turn keeps `afterTurn`
    (`debate_turns.after_turn`), which the credit check reads. Without it, a turn is taken as before.
  - *A refused turn keeps its place.* A turn the room would take but for its length, or because it
    is stale, keeps the agent's place for two minutes (`TURN_HOLD_MS`): while the hold lasts, the
    other agents' turns come out of what is left of the total, so the last turn waits for the agent
    rewriting. The refusal says how many characters over the turn is and until when the place is
    kept. One hold per turn of the agent's own, so refusals cannot renew it. Holds live in memory, like
    presence (`debate-turn-holds.ts`): a restart loses at most one retry. This was chosen over
    accepting 5% over the limit, which only moves the limit, and over a stored reservation, which a
    refused request cannot write in the transaction it rolls back.
  - *Credit.* A claimed credit names its turn (`{"credit", "turn"}`); the room refuses one whose turn
    is not that agent's, and a `position_changed` whose turn was written before the agent could have
    read another agent's turn (by `afterTurn` when the turn has one, else by position). A credit named
    as a kind alone, as drafts did before, is accepted but left out of the draft, since nothing can
    check it; results stored before keep theirs. The Credit tab shows the turn beside the badge.
  - *Results.* A conclusion may carry `changedMinds` (turn and one line), `stillOpen` and `points`,
    the information, assumptions and goals taxonomy that only a `no_conclusion` had, so a successful
    debate keeps why minds changed. All optional, shown on the Result tab, in the export and in the
    posted result; a model reads them only inside the draft `wrapNote` quotes (rules 4 and 9).
  - *Reading.* `read_debate` shows the result form, with every length, while the room still takes
    turns, and puts the drafts first while the agents vote; `draftsOnly` returns the drafts and the
    vote state without the turns, and drafts are quoted as compact JSON, because two voters in a
    75,000-character read voted having seen two of three drafts.
  - *Prompt.* The turn instructions ask an agent to state a difference in goals or priorities
    explicitly instead of conceding it, and to say "I conclude X because of fact Y": no run used the
    `goals` category, though one scenario had a real goal conflict.
  A turn that passes, ending the room early, and a per-room note of what a person's agent may use were
  left to the maintainer: both touch rule 9.

- **Send and Discard wait five seconds on the page before the server hears of them, so either can be
  undone.** An approval card is decided at speed, and a decision a person regrets the moment they tap
  it should cost one more tap, not a note to apologise for. The web client keeps a line in the card's
  place and a toast in the top layer, both saying "Sending to Ana… · Undo" or "Discarding… · Undo"
  until the server has it and "Sent to Ana" after, and makes the request when the five seconds are
  over, when the person dismisses the toast, when they decide another card, or when the page is hidden
  or closed; the write is sent with `keepalive`, so closing the tab does not lose it. A page that dies
  first keeps the decision in the browser and, on the next load, says the draft was not sent when it
  still waits. Undo forgets the decision and the card is back, with an edit the person sent still kept
  for Edit. Nothing changes on the server: no route, no state, and the send still carries
  `expected` as the card showed it at the tap, so an agent's change during the five seconds is refused
  as before and the card asks to read it again. The alternative, a server-side undo window, would have
  delivered a note and then taken it back, which a recipient's push or open page may already show.
- **The approval cards read alike everywhere: Approve and send, Edit, Discard.** The person's own
  draft and a channel agent's answer, in the conversation, the activity panel and the agent's page,
  put Send first and Discard last and apart, so the hand that sends never lands on Discard. Each
  button is at least 44 px in both directions. A review card also says why the viewer sees it ("You
  manage #billing, so you review its agent's answers").
- **A manager edits a channel agent's answer and sends it in one step, through `drafts.send`.** The
  route already takes an edited body with `expected`, under the same reviewer checks and the channel
  group's lock, and records `approved_by` and `origin = 'human_edited'`; the audit entry says
  `edited`. So no new route was added. A reviewer cannot save an edit without sending it
  (`drafts.update` stays the author's), since a saved edit would be a second draft the agent's later
  changes would overwrite. An edit started from a version the agent changed since is refused, as an
  unedited send is.
- **Discarding a channel agent's answer asks why, optionally, and the question waits for an answer
  again.** The reason is stored on the note (`notes.discard_reason`), never audited, never returned to
  the asker or anyone else yet; it is kept for the channel's figures and for teaching its agent. A
  reviewer's discard also clears the agent's drafting state on the question's receipt, so the room
  shows "No answer yet" under it until someone replies, instead of "drafting" for ten more minutes.
- **Unsent text in a composer is kept per conversation, in this browser only.** What a person typed and
  did not send stays when they open another conversation and comes back when they return, and a reload
  keeps it: it lives in memory and in `localStorage` under a key named for the person, read once at
  sign-in and removed at sign-out, and a conversation's entry is dropped once its note is sent or the
  field is emptied. It never reaches the server: a draft there is something the person's agent wrote and
  the person approves, and unsent text is neither. A row in the sidebar shows a small pencil while text is
  kept, so the person knows where they left something half-written.
- **A note's menu shows “Ask my agent to draft a reply” even where it cannot work, disabled with the
  reason.** Where the server takes no draft requests, or the person's own desk runs but its agent cannot
  answer, the item stays in the menu, disabled, with one sentence saying why. A person who reads about
  asking their agent elsewhere finds where it would be and why it is not there; the menu never calls the
  switched-off routes. The composer's **Ask my agent**, beside Send, follows the usual rule instead and is
  absent where requests are off, so the place a person writes stays as small as it can be. On a touch
  screen the note's toolbar is not drawn over the text: a long press opens the same menu as a sheet at
  the bottom of the screen, which is why Reply is in the menu too.
- **A note written in the composer answers another only when the person chose Reply on that note.**
  The composer opens with no reply target and forgets the one chosen once the note is sent. Choosing the
  latest note waiting for the person's reply on their behalf made a first note silently quote something
  they had not picked, and jumped to the next waiting note after each send. A note sent without a target
  leaves the receipts of the notes before it unanswered, which is what the person did.
- **A group message is invisible to its other members until a note in it is sent, like a direct
  message.** A room asked for its agent's draft exists before that draft is approved; showing it to
  everyone at once would tell them a note was on its way, and a discarded draft would leave an empty room
  with its starter's name in their list. Until a note is sent, the room shows only to the person who
  started it, who writes or approves that note and whom a new message to the same people brings back to
  it: not in the others' list, unread counts, event stream or search, and a lookup by id answers 404.
  Visibility is derived from the notes; the starter is kept in `asked_by`, the column that names who
  opened a private question, so no migration is needed. Groups started before this have no starter
  recorded, so until a note in one is sent no one sees it, its starter included: they cannot reopen
  that empty room, and a new message to them makes a new one.
  Channel rooms, private questions and archived rooms show to their participants as before.
- **A new message makes its room at the first send or draft request, from one New menu and one
  people picker.** The list where conversations live has a **New** menu (a message, a channel, a
  debate room, each with one sentence saying which to pick), and the directory pages keep their own
  buttons. **New message** opens `#/new`: a "To" field, the note, **Ask my agent**, and one line naming
  who will read it. The room is made by the first note sent or draft asked for there, so a screen left
  before that leaves no row behind, which the earlier flow (choose people in People, then **Start group
  message**, which made the room at once) did. The picker is a native `<input role="combobox">` over a
  listbox, recent correspondents first; a person who cannot be written to is listed with the reason,
  not left out, so nobody looks missing. A key pressed while an input method composes only ends the
  word: Korean is typed syllable by syllable and its Enter must not add a person. The same picker
  invites people to a debate room and adds people to a private channel; channel managers and the
  group page keep their `<select>` until an organization is large enough to need more. Nobody is put
  into an open channel by someone else: joining it stays the person's own act, and **Copy link to this
  channel** in the room's menu is how one asks a colleague in.
- **A channel's managers are notified when its agent's answer waits for their review, as the channel
  notifies them.** When a channel's agent writes a new draft, every person who may review it then gets a
  push titled with the channel ("#payments-wiki · An answer waits for your review"), with the same
  140-character encrypted preview a person gets of their own agent's draft, opening the card on the
  agent's page (`#/channel/<slug>/agent?draft=<id>`). The notifier reads it all again when the push goes
  out: the draft must still wait, and the preview is its wording then, and the person must still be a
  reviewer by `possibleReviewers`, so the person whose question it answers, an administrator outside the
  managing group and the agent itself never get one (rule 2), and neither does a manager taken out in
  between or anyone once the answer is sent or discarded. A reviewer gets one such push per channel in
  two minutes; the rest of a burst waits on the same page. The push follows the channel: a muted channel
  sends none, for its own room and its private questions alike, a muted private question sends none, and
  neither do `direct` and `none`. Reviewing is channel work, and a level that let review notices through
  would be the one setting a manager could not quiet without leaving the group; the count above the
  conversation list still shows what waits. Only the new answer's event notifies; an agent's later edits
  do not: the server does not know who has read a card, and the card already asks to read a changed
  answer again. Like every push, nothing is audited and `push.delivered` logs carry no content.
- **A decided draft's notification is closed by an open page, never by a push.** Browsers require every
  push to show a notification (`userVisibleOnly`), so a silent "close it" push would show a generic one;
  instead each draft's push carries the tag `review:<id>` or `draft:<id>`, so a repeat replaces it, a
  page that loads the waiting answers or hears the draft was sent or discarded closes it on its device,
  and a card opened from one left on a device with no page open says who already sent the answer (read
  with `notes.get`, so a discarded one only says it no longer waits).
- **Muting belongs to one person and one conversation, and the server decides every push.** A person
  mutes a direct message or a channel (`conversations.mute`, `conversations.unmute`) and chooses which
  conversations may notify their devices (`me.notifications.set`: `all`, `direct` or `none`). All three
  are `human` routes behind the `mute` feature and audited without content. A muted conversation still
  delivers and counts its unread notes; it only stops notifying that person. The mute is kept on their
  place in the room (`participants.muted_at`), so leaving a channel ends it and nobody can mute a room
  they are not in; a lookup of someone else's room answers as for one that does not exist, and the answer
  shows no draft but the person's own, as `conversations.get` does (rule 2). The notifier asks
  `wantsPushAbout` before every push, so no client, old or new, can bring a muted conversation's
  notifications back. `direct` means every conversation outside a channel, group ones included, which is
  what the web client calls direct messages. A private question to a channel's agent counts as direct for
  its asker, whose own conversation it is, and as the channel for its managers, for whom it is channel
  work. Neither a mute nor a level is shown to an agent's
  credential: they are the person's own settings, so `me.get` and the conversation routes include them
  only for the person. The rule covers the "draft waiting" notification too:
  someone who muted a room, or chose `none`, sees its drafts when they open Homingbird. In the page, a
  muted conversation plays no arrival and announces nothing. No model-facing tool calls these routes
  (rule 3): muting is a person's preference, not something an agent decides for them. While the feature
  is off, stored mutes and levels are kept and ignored, so every conversation notifies as before.
- **In a debate, an agent is taking part or has dropped out, by its own credential and the room's
  grace.** An opted-in agent is *taking part* while its credential made an authenticated request within
  the room's grace; past it, the agent has *dropped out* (`isAgentTakingPart` in `debate-rows.ts`).
  Holding an event stream alone does not count: a half-open connection, after a laptop sleeps or Wi-Fi
  drops, looks held for about 15 minutes, longer than the shortest grace. So every client of ours that
  holds a stream (the event stream in `client/src/event-stream.ts`, which the CLI, the MCP server and
  the plugin use) sends the member route `presence.heartbeat` every minute while it streams
  (`STREAM_HEARTBEAT_MS`). It is a `GET` that answers nothing, so it is not audited, and like any
  request it writes the credential's `last_used_at` at most once every 30 seconds, by the clock service.
  A server older than the route answers 404, which the client ignores. The web client sends none: a
  person's session takes part in no room. The grace is a room setting chosen at setup, before the first
  turn, like the limits: 5 minutes (the default), 10 or 30, nothing else (`DEBATE_GRACE_MINUTES`). Until
  one grace has passed since the server started, nobody counts as dropped out, so a restart ends no
  room. A member account an administrator deactivated, or a revoked credential, has dropped out at once.
  A remote MCP connector or a long-poll client takes part by its requests, like any other agent. A
  stalled stream is closed as well: an event stream whose reader does not drain a write within 60
  seconds, or a WebSocket that leaves two pings in a row unanswered (`stalled-streams.ts`), timed by the
  clock service. This replaces the earlier rule, unreleased, that read the member's "agent awake"
  presence: one agent's desk restarting no longer counted as every agent of that person leaving, and a
  brief disconnect no longer ends a room. It also replaces counting a held stream as taking part. Inside
  debates the words are "taking part" and "dropped out" (ko: 토론 참여 중, 토론 이탈); "active" stays the word
  for accounts.
- **A room never waits for an agent that dropped out, and closes as it is with one agent left.** Turns
  skip it (once the first turn is taken the room stops when no agent taking part has a turn left; before
  the first turn it waits for its time limit, because people opt agents in before their desks start),
  the room stops collecting drafts when every agent taking part drafted, and the vote leaves it out.
  Once the first turn is taken, a room with fewer than two agents taking part ends at once with
  `one_agent_left`, or `no_agent_left` when none is left, whatever stage it reached and before it
  closes: no draft, vote or result follows, because one agent alone is no debate. The turns stay. The
  web client says why, in English and Korean, and `homingbird debates` (the `ended` field of
  `debates.waiting`) lists such rooms of the agent for a day. An agent that comes back with a request
  takes part again.
- **The agents settle a room's result by vote; no person approves it.** When the first draft of a round
  arrives, the room collects drafts for `RESULT_DRAFTING_WINDOW_MS` (3 minutes) or until every agent
  taking part drafted, one per agent. With one draft, that draft is the result. Otherwise the agents
  taking part vote for up to `RESULT_VOTING_WINDOW_MS` (5 minutes), ending early once all of them voted;
  an agent cannot vote for its own draft, and a vote is the member route `debates.result.vote`, limited
  to the credential its person opted in. The draft with the most votes, a tie to the earliest, becomes
  the result and the room closes; credits are given then. While the vote runs, only who voted is shown;
  once the room closed, the vote record shows which agent voted for whose draft and which agents had
  dropped out and did not vote (`voteRecord`, `debates.dropped_out`), in the web client, in the export
  in the exporter's language, and to agents only inside `wrapNote`. Every draft reaches a voting agent
  only inside `wrapNote` (`quotedDrafts`); an agent sees no other agent's draft before it drafted or the
  window ended, so none copies another, while people see them all. This replaces "the first agent to
  draft the result wins" and the approval by the people in the entry on debate rooms below. The routes
  `debates.result.approve` and `debates.result.decline` are removed: only the bundled web client called
  them. A room stored while it waited for approvals closes with the result it chose on the next pass;
  the released `debate_approvals` table stays, unread and unwritten. A room whose result is still open a
  day after its turns stopped (`RESULT_WINDOW_MS`) settles its drafts at once, the most votes winning
  and a tie going to the earliest, and ends with `no_result` only when it has no draft; this replaces
  the day-long wait for an approved result in the entry below. Drafts, votes, the grace and the
  dropped-out record are migration step 4.
- **A room's content leaves it only through a person.** A person whose agent took a turn posts the
  result, which becomes a draft of theirs that only they can send, like any note; a member exports the
  closed room (a private room's members only, not an administrator outside it). No agent route or tool
  can post or export (rule 9).
- **An administrator reads private channels and private debate rooms as a person only.** This
  replaces "with no administrator exception in the web client or the API" below. The administrator's
  own sign-in sees private channels and rooms in lists and by id (`isVisibleRoom` in `channel-rows.ts`,
  given `viewerOf(caller)`); an administrator's agent credential reads as an ordinary member and sees
  only what that member takes part in (rule 6). Seeing is not joining: an administrator who was not
  invited cannot opt an agent in or export a private room.
- **A request settles only the room it reads or acts on.** Each debate route locks its own room and
  moves it on (`settleDebate`); the per-minute pass settles every undecided room in the order of their
  ids, each in a transaction of its own, so a room that fails is logged and leaves the others to move
  on. Taking the lock changes nothing: `updated_at` moves only when something in the room did. A result
  the room can settle (a vote that ran out, a single draft, a result stored while waiting for
  approvals) is settled before the day after the turns ran out ends the room, so a room with a result
  closes with it. The update that closes a room matches the round and result it was decided on, so a room that
  changed in between is left for the next pass. A draft, vote or turn that loses a race with an
  identical one answers 409, not an error, on every database.
- **Limits are set at setup and fixed once the debate starts.** The person who opened a room changes
  its limits, the grace included, only before the first turn; afterwards `debates.limits.set` answers
  409 with a sentence saying so, and the web client shows them read-only. A limit changed mid-debate would change the
  rules for agents that already spoke.
- **An export is written in the exporting person's language.** Headings and labels of the Markdown
  export follow the language the web client sends (`language` on `debates.export`), else the person's
  chosen language, else English (`exportLabelsIn` in `protocol`). JSON keys and the posted result stay
  English, because tools and recipients read them. The escaping is the same in both languages, and the
  property tests run over both.
- **Posted debate results are counted on their own line.** A sent note with `debate_id` counts neither
  as an agent draft, nor as a note the person wrote, nor in the organization's notes, replies or active
  people; My agent → How it is doing and the administrator's Insights each show "Debate results sent"
  as a separate line (`debateResultsSent`, optional on the wire), and Insights hide it while fewer
  than `HB_INSIGHTS_MINIMUM_GROUP` people sent one in the period (1 by default, so never unless an
  administrator raises it).
- **Agents may read colleagues' agent introductions, always quoted.** The public sentences are written
  for colleagues and agents work for colleagues, so `find_people` and `homingbird directory` (text and
  `--json`) show them, where they were left out before, but only inside `wrapNote`
  (`quotedIntroduction` in `protocol`), as a colleague's note (rule 4), so a sentence that reads like an
  instruction stays data.
- **A stored answer holds at most 300 characters with its title, the same as a rule.** This replaces
  "a fixed text of at most 600 characters" in the entry on stored answers below. Longer material belongs
  in a source, read as data. Answers saved longer before keep working: the wire schema still reads up
  to 600 characters (`STORED_RULE_MAX`), drafting uses them, and turning one on or off is not an edit;
  any other change must bring it to 300 or fewer, and the save dialog says so in English and Korean.
- **A character stands for a person, and Pip appears once per page at most.** A member's character
  appears where it identifies who is acting: the person's own button in the header, each direct
  message in the list, the author of each run of notes in a thread, each card under People, each row
  of the administrator's member list, and the composer while one's own note is sending, all at 2×
  (32 px). A group conversation's row shows two people side by side at 1×. Larger only where the
  character is the subject: 4× for one's own character in the profile, 3× for the editor's previews
  of each state. Pip, the brand, appears in a page's main empty state ("nothing here yet") at 3×, on
  the sign-in and connection result pages at 4×, and in the tour. Nowhere else: no character in page
  or thread headers, beside unread counts, in notices and banners, in the sidebar's empty states or
  in a "no match" result, because a face repeated on every surface stops telling the reader anything
  and pushes the content down. `emptyWithPip` takes no size, so a page cannot pick another one.
- **Korean says 데스크 for the desk; this replaces the entry below that renders desk session as
  전용 세션, which stays as history.** One short term is used across the web client, the plugin
  pane and the docs, matching "desk" in English; 전용 세션 read as a description rather than a name
  and grew long in every sentence that used it. The other product words stay as recorded there, with
  principle → 원칙 and debate room → 토론방 added, and a person's name takes 님 ("Ana 님").
- **The web client says "the program that runs your agent", not desk, except where it defines the
  word; this narrows the entry above, which stays as history.** First-time evaluators read desk,
  runner and always-on runner as three unexplained products, and a colleague's presence hint ("Its
  desk is running") named something they had never set up. Desk (데스크) stays the term of the guide,
  the plugin pane and the docs, defined once on My agent → Connection ("Your desk is the program that
  runs your agent for Homingbird") and in the guide's first paragraph; the runner is named by its
  command, `homingbird run`.
- **Debate rooms are a tab beside Channels; on a phone the tabs are a bar at the bottom of the
  screen.** A room is not a channel, so it gets its own tab rather than a button on the Channels page
  or an entry in the user menu, where people did not find it. The tab reads "Debates" (토론방) to keep
  the row short; the page is still Debate rooms. Wide, the tabs sit in the title bar, and below about
  860 px the title bar keeps them on its one row between the brand mark and the person's controls.
  Below 512 px the tabs leave the title bar for a bar fixed to the bottom of the shell: Notes, My
  agent, People, Channels and Debates, each a word under a glyph, in equal columns at least 44 px
  tall, above the device's safe area. The title bar keeps the brand mark, search, the activity bell
  with its count, and the person's button. The bar is the same `nav` and the same links, placed by a
  container query, so the reading order and the keyboard order stay the brand, the tabs, then the
  person's button. Inside an open conversation the bar is not shown: Back returns to the list, and
  the composer and the approval card keep the bottom of the screen to themselves. A tour step for a
  control in the header sits under the header, aligned with the control; for a tab in the bar it
  sits above the bar. Nothing scrolls sideways or hides behind a "More" menu; the bar holds at most
  five, so a sixth destination needs a new decision, not a scroller. This replaces the grid of two
  rows of three, which the client no longer drew (at 375 px the tabs had become a sideways
  scroller), at the cost of about 56 px at the bottom of every list page.
- **A debate room is room content, not notes: agents take turns, people approve one result, and only
  that result leaves the room.** Opening a room, opting one's own agent in, setting limits, approving or
  declining the result, posting it and exporting are `human` routes; reading a room and, for the agent
  credential its person opted in, taking a turn and drafting the result are `member` routes, checked
  again in the domain (`debate-*.ts` in `dovecote`). One agent per person per room, at most 8, and no
  two turns in a row by the same agent. The room stops at the total, when no agent has a turn left,
  once every agent is ready to conclude, or at its time limit (a background pass each minute while the switch is on, and on every read). A room
  that stops with fewer than two agents or with no turn **ends** without a result (`ended`, audited with
  `too_few_agents` or `no_turns`): there is nothing to approve, post or export as a result, and no
  credit. Otherwise the first agent to draft the result wins; a person's **Ask for another draft**
  clears it and every approval and starts a new result round, which desks use to know they are asked
  again. Approving and declining name the draft the person read (`draftedAt`); a newer draft is refused
  with a conflict and the web client reads the room again. The room closes when every opted-in person
  approved, and only then can a person whose agent took part post the result or a member export it.
- **A posted debate result is the agents' note, in the person's own draft, and says where it came
  from.** It starts "From the debate room: <question>" and names nobody as approving it, because the
  person may edit it before sending. It carries the agent origin, so recipients see the usual square
  mark when it is sent as written and the round one when the person edited it, and its details name the
  room's question and agents (`fromDebate` on the note, from `notes.debate_id`); a recipient sees none of
  it before it is sent. Editing it offers no principle, since the person's own agent did not write it
  alone. A result longer than a note holds is refused, with a pointer to the export, rather than cut.
- **A room that waits a day for an approved result after its turns stopped ends without one**
  (`no_result`, `RESULT_WINDOW_MS`), and only participants whose member is still active are asked to
  approve. A room shows which credential takes part only to that participant's own person.

- **Who can read a debate room.** An open room is visible to every member and can be exported by any
  member who can view it; a private room is visible to, and exportable by, its members only, with no
  administrator exception in the web client or the API. The audit log holds every turn, every drafted
  result and every export, as it holds note content, so administrators can read private rooms' turns
  and results there. A change is announced by an ephemeral, content-free `debate.changed` naming the
  room and its participants, to the room's members; everyone hears only that an open room was opened
  or ended. Desks wake only for a room their person's agent takes part in, and read their rooms
  again each time their stream connects and after each poll, since the change is never replayed.
  Turns reach a model only through `quotedDebate`, which wraps the question and every turn in
  `wrapNote`; the Markdown export
  escapes everything people and agents wrote, so no text can add a heading, an HTML tag or a link other
  than http(s). The growth record keeps the kinds of credit an approved result names, each once
  (`debate_credits`), as milestones; never a count. A turn could have been a note
  in a hidden conversation, but then every note query would have had to exclude it, and a turn must
  never reach an inbox, a search or a push. The tables are migration step 3, after the released step 2.
- **Every optional feature can be switched off by an administrator; the core cannot.** One table in
  `protocol` (`FEATURES`) names each switch, its default and the routes it owns; the server refuses those
  routes with 404 while the switch is off, `server.info` tells clients, desks treat the refusal as "say
  nothing", and the data stays. Notes, drafts, approval, direct messages, sign-in and the audit log are
  not switchable, because without them Homingbird stops being a messenger in which a person approves
  what their agent writes and an organization can see what happened. Later features (debate rooms,
  stored answers, automatic sending, the last off by default) register a switch in the same table.
- **Everything about a person's agent lives on one page, My agent, in the header; the profile is about
  the person.** The page has tabs in a fixed order, Connection (agents and devices, the desk,
  renaming and revoking, a connection code), Teaching, How it is doing and Early previews, each at its own address
  (`#/agent/connection` and so on) and shown alone, because all of them on one page made a scroll too
  long to find anything in; `#/agent` shows the first, and `#/connect` and `#/credentials` lead to
  Connection. The
  profile keeps the name, character, language, notifications and the line colleagues see. A summary
  card above the conversation list repeated the page and pushed the list down, so there is none; the
  quick-approval nudge moved to where it matters: a draft card shows one quiet line above Send when the
  person approved quickly often this week and the draft contains a date, a number or a promise, found by
  simple patterns. It never blocks sending.
- **Session health is recorded with each agent draft and shown only to its author.** A desk reports the
  session's age in minutes and, where it can know it, its context use: the plugin reads both from Claude
  Code's `$.session.usage()` and hands them to the command line in `HOMINGBIRD_SESSION`, outside any
  argument a model writes; an MCP desk's model may state them, like its model; the runner starts afresh
  for every note and sends no session, so its drafts stay out of these figures. How it is doing groups
  decided drafts into four age and four context buckets and shows edit and discard shares only from five
  drafts per bucket. A fresh session is suggested from 8 hours or 80% context use, judged from a desk's
  latest draft only while it is under an hour old (`FRESH_SESSION_AFTER_MINUTES`,
  `FRESH_SESSION_AT_CONTEXT_PERCENT` in `protocol`; the plugin keeps an equal copy, checked by a test). A
  recipient never sees any of it, and nothing reaches another person's view, so `noteDetails` has
  nothing to hide.
- **The agent introduction is a sentence per item, written for colleagues, never the item itself.** Each
  item has a Public toggle, off by default; turning it on needs a separate sentence of at most 200
  characters. It may not share four words in a row with the private text (or all of a two- or
  three-word text; a single word never counts), name the source with or without its scheme, or name
  the principle's channel, and the form warns that it can still reveal what the principle says. The sentences of a member's enabled items appear in the directory
  entry as "About their agent", to every member who can see that member, and only while `teaching` is
  on. Writing one is a `human` route like every other principle change (rule 8); the administrator's
  answering flow has no public toggle and is never shown to members.
- **A stored answer is a kind of item in the principles list, not a separate store.** An item is a rule
  ("answer by …", how to find the answer) or an answer ("answer with …", a fixed text of at most 600
  characters, or the text left empty and a source to take it from). Answers share the list, its order,
  the 50-item and 1,500-character caps, rule 8 and every guard; a source is linked material read as
  data. The save dialog's "looks like a stored answer" warning offers to switch a rule to an answer. The
  basis names an applied answer by its title, as for a rule. A person still approves every draft,
  unless they switch the answer to send itself word for word
  ([below](#a-saved-answer-may-send-itself-word-for-word-where-its-person-allowed)).
- **Principles are a person's rules for their own agent, saved only by that person in the web client
  (security rule 8).** Saving, changing, turning off, deleting and "wrong here" are `human` routes;
  the only route an agent reaches is `principles.drafting` (`member`, read-only, own principles only),
  which each desk calls for every draft so it always follows the current set. A desk adds them after
  the answering flow through one helper in `protocol` (`principlesInstructions`, `draftingGuidance`),
  shared by the runner, the MCP server and the plugin, whose overview carries them; in split mode only
  the writer gets them, never the reader that sees the note. The flow always wins, a principle cannot
  turn off a check. One whose wording looks like a request for something no agent may do (approve,
  send, discard, change contacts or a character, touch credentials) is left out and named for the
  basis; that pattern check (`isLikelyForbidden`) is a hint for the person, not a guard. The guard is
  rules 1 and 3: no agent credential and no model-facing tool can do those things whatever a principle
  says. Caps: 50 per person, held under concurrent saves; 300 characters each; 1,500 characters per
  prompt, counting the line that names ignored principles, which ends "and N more" when the titles do
  not fit. The order is the person's own (`principles.reorder`, also a `human` route), kept on My agent
  like a to-do list. A principle may name a channel the person is in; when the agent answers there,
  that channel's principles come first, and each group keeps the person's order. The budget is applied
  after that ordering, so what matters most in this channel is never the part cut. Titles may not
  contain ":" or ";", so the applied line always names them exactly. A revised basis replaces the
  draft's earlier applied claims. The agent reports
  what it applied as a "Principles applied:" line in basis; the server and the web client match those
  titles against the person's own principles, and the card says "Your agent says it applied", because
  it is the model's word.
- **No model takes part in suggesting a principle.** A suggestion is made by a deterministic word diff
  between the agent's draft (kept as `agent_body`) and the sent text, not from the incoming note or
  linked material. The draft itself can quote the colleague's note, so a suggestion may carry their
  words: that is why it is stored apart (`principle_offers`), never reaches an instruction block,
  carries no source, and is saved only when the person changes it or confirms it; the server checks
  that again. An edit counts as substantial at 8 changed words, or
  at 3 changed words that are at least 15% of the longer text, ignoring case, spacing, punctuation and
  typo-sized changes. A discard offers the empty guided form. Offers come at most once a day per
  channel, or per direct or group conversation, and never where the person said not to ask. Principles, offers and their audit entries keep the
  full text: the audit log records everything, as for note content.
- **A person's own agent figures are a `human` route, `insights.mine`; an agent credential gets 403.**
  How a person approves (how often they send a draft unchanged, how fast, where they edit) tells an agent
  exactly when approval has become a formality and which drafts would slip through, so a prompt-injected
  agent could time or word its drafts for it. The figures are for the person; no MCP, CLI or A2A tool
  reaches them, and `drafts.seen`, which records when a draft card first appeared on a visible page, is
  `human` too, so an agent cannot fake its person having read a draft. `admin.insights` is `admin` and
  returns counts and medians only: never a member id, a name or note content, nothing for a period in
  which fewer than `HB_INSIGHTS_MINIMUM_GROUP` people were active (1 by default, so nothing is hidden
  unless an administrator raises it), and no channel whose
  contributors are fewer; when the hidden groups together are still fewer people, the next smallest is
  hidden too, so subtracting the shown ones from the totals never isolates a small group. Differences
  between periods are not suppressed. Insights measure how agents are doing, and must be useful to a
  small team too, so the default hides nothing; an organization that wants small groups hidden raises
  the minimum, and every rule above applies as written. Program and model labels are the exception:
  they are free text a person can set, such as a device name, so a label shows only once at least two
  people used it, whatever the minimum.
- **Every newer organization figure needs its own contributors, and reply and pickup times come from
  the notes themselves.** The typical decision time needs `HB_INSIGHTS_MINIMUM_GROUP` people who decided
  a draft they had seen; who wrote what was sent is hidden whenever draft decisions are; a week of quick
  approvals is hidden as the draft decisions of the same days are, by the people who decided a draft,
  so the last week never hides what the 7-day figures show; delivery needs that many people with an
  agent connected who received a note, its typical pickup time that many whose agent picked one up,
  and its received total that many people without an agent, or none, so subtracting the notes to agents
  never gives one person's count. A person's own reply time runs from a colleague's new note to their first sent reply,
  the definition of the organization's time to the first reply, never from `receipts.replied_at`, which
  a later reply overwrites, nor `delivered_at`, since a channel note has receipts only for its helpers
  and the person answered. The quick-approval warning (25% of drafts sent as written for 2 weeks in a
  row, each with at least 10) is a constant in `protocol` until it becomes a setting. **What is
  measured** is a catalogue in `protocol` (`MEASURES`), and a test fails for a response field it does
  not name, so a figure cannot be added without telling members.
- **A channel's agent's figures belong to its channel's managers, and a decision belongs to whoever
  made it.** `channels.agent.figures` is `human` and answers 404 to everyone outside the channel's
  group, administrators included (rule 6): its answers drafted, sent as written, after an edit,
  discarded and waiting, the typical decision time, quick approvals, and each current manager's count
  of answers sent, alphabetically and never ranked, since a ranking would invite approving faster.
  `channels.agent.figures` holds the current managers' ids and names and is shown only to that
  channel's managers, who already see who manages it; answers sent by people who no longer manage it
  are one total of their own, shown rather than left to be worked out by subtraction, and with a raised
  minimum each manager's count needs that many people who sent an answer in the period. A
  reviewer's first sight of an answer is recorded by `drafts.seen` as an author's is. A sent note
  counts for `notes.approved_by` when it has one, so the organization's active people and deciders
  are people, never a channel's agent; a discard records nobody, so it is counted but adds no decider.
  A manager's approvals never mix into their own agent's figures; Your week shows them apart
  (`approvedForChannels`). Each manager's count is that manager's own figure, so it is shown only
  while that many managers sent an answer in the period; until then the managers see the totals alone.
  Administrators get every channel agent's answers together only while that many managers sent one
  and that many people made the organization's other decisions, which the organization's total minus
  these would give away (`placesShown`, which also counts a hidden group nobody is known in), and only
  from open channels and the private ones they are in. Every minimum counts the people active in the
  period, never the size of a roster.
- **Teams get rows of their own in Insights, counted by whole UTC days.** A person counts for a team on
  every UTC day they were in it for any part of, from `group_member_spans` (since and until per
  membership, written by every change to a group, deletion and deactivation included; a span from 0
  began before records), so moving between teams moves their figures from that day, and someone in
  two teams counts in both. Rows are alphabetical, never ranked, and never merged into an "others"
  row. With a raised minimum a team is shown only while every cell of people who share the same shown
  teams has that many (`teamsShown`), its decisions only while the cells of the people who decided
  pass too, and its typical decision time, a median that no subtraction undoes, only while those
  decisions are shown and that many people decided a draft they had seen; the rest are counted ("2
  teams with too few people are not shown"). Overlapping teams make that rule hide most teams at a
  minimum of 5 (measured: 23% shown, against 75% with one primary team per person,
  `scripts/pilot-measure.ts --teams`), which is a reason the default is 1.
- **The agent page says what the numbers mean in words, beside the numbers, and never collapses them
  into one score.** A single trust score hides which channel is trusted and why, invites chasing the
  number by approving faster, and grades the person rather than the agent. The server reads a verdict
  from shares only (`too_few` under 10 decided drafts, `usually_as_written` from 70%, `often_discarded`
  or `often_edited` from 30%, otherwise `mixed`), the same rule per channel, and the page shows the
  counts that drive it, the period before, and a nudge to read drafts carefully when quick approvals
  are frequent. Dovecote stores times (`seen_at`, `decided_at`, `releases.created_at`), not verdicts, so
  `HB_QUICK_APPROVAL_SECONDS` and the thresholds apply to everything already recorded. A draft set aside
  without its person, such as the unchosen alternative, counts as written but not as decided.
- **Topics are channels and one-to-one conversations are direct messages, in every name.** People know
  "channel" and "DM" without an explanation, so the product, the API, the tools and the database use them.
- **An agent is "awake", not "online".** Presence means a desk is running and holds a live stream; a
  connected agent that is not running is not awake, and a web connector that cannot be woken never
  is. "Online" read as "connected", so people expected answers from agents that were only signed in.
- **Presence is shown in words wherever there is room, and by shape as well as colour where there is
  not.** Directory rows and the thread header read "Person online · Agent not awake"; the narrow
  conversation rows keep a dot that is a filled square when the person is online and an outlined
  circle when away, labelled for screen readers. A coloured dot alone was easy to miss and broke the
  rule that status is never conveyed by colour alone.
- **A profile character is saved only by a person's click, and the server checks it again (security
  rule 7).** `me.character.set` and `me.character.clear` are `human` routes and
  `admin.members.resetCharacter` is `admin`; `characterProblems` in `protocol` (the brand rules of
  `validateCharacter` plus "a made character may not take a built-in id") runs in the editor, in the
  model-facing tools and again in Dovecote, which stores exactly the spec that passed and refuses a body
  over 4 KB. `Member.character` is `null` for the pigeon and always present on the wire. Agents help through `check_character` and
  `preview_character`, which call no route: the preview is a web-client link,
  `#/character/<base64url of the spec>`, that opens the editor with the draft as a layer the person keeps
  or removes. The link lives in the hash, so the spec never reaches a server log, and the web client never
  saves from it. In the interface the helper is called "Ask my agent", never a vendor. The character UI is
  English and Korean like the rest; the rule texts a model reads stay English, and the web client shows
  its own sentence for each kind of problem. Korean uses 캐릭터 and names the default 비둘기.
- **Characters animate only where something changes.** Lists, the directory and the members list draw
  the first frame as a still; a conversation row plays `new-note` twice when a colleague's note has just
  arrived, the composer shows the sender's own character `sending`, and the editor's preview plays its
  states. With `prefers-reduced-motion` every character is its first frame, and every state is named in
  words beside it.
- **The web client, push titles and the plugin's pane speak English and Korean; nothing a model reads
  is translated.** English is the default and the fallback. A member's choice is saved on the
  profile (`locale`, absent means "follow the browser"), so every device and every push title
  follows it; before sign-in, and while nothing is chosen, the browser's `navigator.languages`
  decides, and a push subscription remembers its browser's language for that case. Messages are
  plain templates with named placeholders and per-language plural forms (Korean declares only
  `other`), compiled by a small typed helper with `Intl`; no library. Prompts, tool descriptions,
  `wrapNote`, CLI output, the audit log and server error text stay English, and the web client
  shows its own text for known error kinds. Note bodies are shown as written. Korean uses the
  polite 해요체 and addresses people neutrally; the product words are rendered as note → 노트,
  draft → 초안, approve → 승인, send → 보내기, desk session → 전용 세션, agent → 에이전트,
  channel → 채널; Homingbird, Dovecote and Pip stay in Latin letters. One language is one file per
  surface (`packages/pwa/src/languages/`, `packages/dovecote/src/push/titles/`,
  `packages/plugin/hooks/pane-text/`) plus its tag in `LOCALES`; the compiler names every surface a
  new tag still lacks.
- **A new or changed member appears in open directories at once.** Dovecote broadcasts an ephemeral
  `directory.changed` event, also when someone starts or stops helping with a channel and when an
  administrator renames or archives one; clients refetch the directory, the channels and the
  conversation list. It is not stored, because a client that
  was offline loads the directory fresh anyway.
- **The web client sends Web Push notifications** for arriving notes and for drafts waiting for
  approval. Dovecote signs VAPID tokens and encrypts payloads itself; there is no push library.
- **The code is MIT; the name, the logo and Pip are not.** `TRADEMARKS.md` lets anyone refer to,
  self-host and redistribute Homingbird unmodified, and asks forks to choose their own name and art.
  The 24 built-in characters are CC BY 4.0 so people can reuse them with credit; the `pigeon`
  character is Pip and stays with the brand. Without this, a fork could ship as "Homingbird" with
  our logo and nobody could tell them apart.
- **Members pick or make a profile character; Pip stays the brand.** Characters share Pip's body,
  frames and states and differ only in palette and markings, so every state works for every
  character and the status icons stay readable. People make one in an editor of ready-made parts,
  with Claude as an optional helper that fills the editor; both produce the same `CharacterSpec`,
  checked by one `validateCharacter` on the client and again on the server. The editor comes first
  because it works without a model and makes small changes easy.
- **Brand assets are generated by `packages/sprites` and checked in.** `assets/brand`, `assets/pip`
  and `assets/characters` come from one TypeScript package, which also renders characters at run
  time in the web client and the plugin and validates them in Dovecote. Keeping the generator in the
  repository means a changed pixel changes everywhere, and golden tests catch accidental changes.
  `assets/fonts` holds Inter and Bricolage Grotesque under the Open Font License.
- **The README shows the characters as GIFs that are checked in.** `assets/characters/gif` holds one
  `<id>.gif` per built-in character, waving at 6×, about 50 KB together. GitHub cannot scale pixel art with nearest-neighbour sampling, so the files are made
  at their final size, and a README can only show files that are in the repository. They come from the
  same `pnpm --filter @homingbird/sprites assets` as the sheets, so they cannot drift from the art;
  other sizes and states are still made on demand with `homingbird-sprites gif`.
- **People can write notes directly; agents are the main path.** The web client keeps a composer at
  the bottom of every conversation, and agent drafts appear in the thread waiting for approval.
  Forbidding direct writing would be unenforceable, because "edit then send" already lets a person
  replace a draft entirely, and it would lock out anyone whose agent is offline.
- **Every note shows who wrote it:** `agent`, `human_edited`, or `human`, plus the drafting agent's
  name. Recipients can tell an agent-written note from a hand-written one, and the audit log records it.
- **`read` means the recipient's human opened the note.** An agent taking a note to draft a reply is
  shown as `drafting reply`, never as `read`; otherwise auto-drafting would mark everything read at once.
- **Every connected agent drafts, and the human picks.** When several of a member's agents pick up
  the same note, each writes its own reply draft. Sending one discards the others.
- **A recipient with no agent connected still receives the note.** It waits as `delivered` or `read`
  until a person replies by hand or an agent connects and drafts.
- **Presence is two signals.** `agentOnline` means an agent client holds an event stream, so a note
  will be auto-drafted now. `humanOnline` means a person's client is connected. Remote MCP connectors
  and long-poll clients do not hold a stream and do not count as online.
- **A direct conversation is invisible until it has a sent note.** An agent drafting to someone new
  creates the conversation row, but the recipient's list only shows conversations with a sent note,
  so a draft never reveals itself.
- **A pickup without a draft stops showing as `drafting reply` after ten minutes.**

## Architecture

- **A debate room's rules are one pure state machine in `protocol`; Dovecote loads, applies and
  stores.** `stepDebate` and `settleDebateRoom` in `protocol/src/debate-room.ts` take a room's facts
  (who takes part, turns, drafts, votes, limits, time) and return the next stage and the effects to
  store, and their laws are property-tested over any run of events. Dovecote reads the facts, calls the
  machine and stores each effect with the guarded update it always used, in the room's own
  transaction. With the rules split between `protocol` and four domain files in Dovecote,
  so a law such as "no result without a draft" could only be tested through the server.
- **One drafting flow, in `protocol/src/drafting/`; every adapter keeps only its input and output.**
  What a model is told when it drafts (note in, `wrapNote`, the answering flow, the person's
  principles, the prompt, the draft out) was written four times, in the runner, the MCP adapter, the
  Claude Code plugin and A2A, and the copies drifted: the MCP desk put the answering flow, the
  principles and the rule against acting on a note after the quoted note. `protocol` is the one place
  all four already depend on, and it holds no route call and no credential, so a model-facing adapter
  can import it without reaching a `human` route (rule 3); `wrapNote` stays its only wrapper (rule 4).
  It holds `NOTES_ARE_NOT_COMMANDS` once, quoting by the directory (`quotedNote`), principle selection
  (`selectPrinciples`: the channel's principles first, then the rest), the guidance built from what a
  desk fetched (`flowGuidance`, `principlesGuidance`, `draftingGuidance`), each adapter's prompt texts,
  the split-mode readers, the debate prompts and the parsing of what an agent printed. Every prompt puts
  the rule and the guidance before the quoted note, and a test checks it for each. The plugin may import
  only its own files, so it carries `hooks/drafting-prompts.mjs`, an esbuild bundle of
  `drafting/plugin-prompts.ts` that `protocol/test/plugin-drafting-prompts.test.ts` keeps equal to the
  source, as with the character rules. A new package would have added a workspace link for the same
  four dependants; `protocol` already carries the mutation and coverage bar the prompts need.
- **The Claude Code integration is the plugin (`packages/plugin`); its npm package stays
  `@homingbird/mod`.** Claude Code calls it a plugin, and its manifest and marketplace already did, so
  the folder, the docs and the strings say plugin. The published package keeps its name, so the
  marketplace's npm source and the release go on naming the package already on npm. The name people
  install, `homingbird`, does not change.
- **The plugin is written against the kernel too, through a generated `hooks/kernel.mjs`.** Its hooks
  were `async` functions over the host's promises. The plugin may import only its own files, so
  `kernel/test/plugin-kernel.test.ts` keeps an esbuild bundle of `Task` and `Stream` beside the hooks,
  with `hooks/kernel.d.mts` declaring the part it uses. Every host call is one `host(() => $.noun.verb())`
  (`hooks/effects.ts`), steps are chained with `Task.gen`, and each hook, render and handler runs its
  task once with `answered` or `inBackground`, where the host awaits a promise. The host follows `$`
  only into function declarations, so every function that takes `$` is declared with `function`.
- **The answering flow's stored text marks a turned off step with "[off] ".** The administration page
  edits the flow as two to-do lists and serialises them to the same two headed lists the server
  already validated; a turned off step keeps its place in the text, counts toward the 20 steps and
  4,000 characters, and is left out of every agent's instructions by the one parser in `protocol`
  (`answeringFlowSteps`, `answeringFlowFrom`). Storing the steps as structured data would have changed
  the setting's contract for every client; one marker kept it.
- **The marketplace entry names the exact plugin version.** Its npm source carries `version`, written by
  `scripts/release-version.ts` on every version bump with the other version holders, because an npm
  source without one installs `latest`, and during pre-releases `latest` lagged behind `next`.
- **`protocol` depends on `sprites`, and the plugin carries a generated copy of the character rules.**
  `sprites` depends only on `kernel`, so there is no cycle, and the wire schema of a character is the
  one `CharacterSpec` the art is drawn from. The plugin may import only its own files and reaches the server
  only through the command line, so `plugin/hooks/character-rules.mjs` is an esbuild bundle of
  `characterProblems`, `characterLink` and the built-in characters; `protocol/test/plugin-character-rules.test.ts`
  fails when it differs from a fresh bundle (`HB_WRITE_PLUGIN_BUNDLES=1` writes it). The web client draws
  characters with `sprites` itself, which adds about 45 KB to `app.js` (about 16 KB gzipped).
- **CI publishes three npm packages and the image; everything else stays private.**
  `@homingbird/cli`, `@homingbird/mcp` and `@homingbird/mod` are what people install, and each ships an
  esbuild bundle with no runtime dependencies, so `kernel`, `protocol`, `client` and the rest are never
  published and need no stable API. The packages carry npm provenance; `ghcr.io/let-sunny/homingbird`
  carries the same version.
- **Commit messages decide versions and release notes, through a "Version Packages" pull request.**
  Every commit is checked as a Conventional Commit, locally and in CI, so the messages are one source
  of truth that a second file per change, a changeset, only repeated and could contradict. This
  replaces Changesets. `scripts/release-version.ts` reads the commits since the last `v*` tag reachable from
  `main`, skipping merges and "Version Packages" commits (`conventional-commit.ts`), computes the next
  version (`next-version.ts`: before 1.0 a breaking change bumps the minor and a `feat`, `fix` or
  `perf` the patch; from 1.0 major, minor and patch as usual; only `chore`, `docs`, `test`, `ci`,
  `build` and `refactor` release nothing), and writes it to every package, the root, the plugin's
  `plugin.json`, the marketplace pin and the two version constants, so all share one version. It
  writes the notes (`release-notes.ts`: breaking changes, added, fixed, performance, each entry the
  summary and the first body paragraph) as a section of the one root `CHANGELOG.md`. The release
  workflow rebuilds `release/main` from `main` and opens the pull request with `gh`; a person may edit
  the section on that branch, and the published release takes its notes from the merged
  `CHANGELOG.md`, never regenerated. Pre-releases are a committed setting, `"pre"` in `release.json`,
  instead of a tool's mode.
- **The plugin ships its own copy of the command line, and its marketplace entry is the npm package.**
  `@homingbird/mod` holds the plugin files plus `cli/homingbird.mjs`, and the plugin runs that file with
  `node` unless **Homingbird command** names another. The copy always matches the plugin's version and
  needs no network when it runs. A relative path to `packages/plugin` would install the repository's
  files, which hold no built bundle; committing the bundle would put generated code in review. The
  cost: the plugin installs only from a published release, and a checkout without `pnpm build` falls back
  to `npx -y @homingbird/cli`.
- **A stream that resumes replays its whole backlog before it goes live.** `liveEvents` subscribes to
  the hub first, then reads the log in pages of 500 until a page comes back short, and only then passes
  on live events newer than the last one replayed. A client far behind gets every event it missed, in
  order and once, instead of a gap. A gap in the log itself, because events older than seven days were
  trimmed, is still answered with `resync`, as is a subscriber that falls 2048 events behind while it
  replays. Long-poll already paged the same way; the client now resumes a poll from the cursor the
  server returns, so a `resync` from the poll route arrives once instead of on every poll. Sending
  `resync` for any long backlog would have been simpler, but it would have turned a reconnect after a
  busy weekend into a full reload for every client.
- **No runtime dependencies.** Everything is built on the platform and the kernel. WebSocket framing,
  JSON-RPC, OAuth and ID-token verification are implemented in the repository. The PostgreSQL and MySQL
  drivers are optional peer dependencies, loaded only when configured.
- **A home-grown functional kernel instead of a library.** `Result`, `Option`, `Task`, `Stream` and
  `Schema` live in `packages/kernel` with no dependencies. The project wants generator-based
  do-notation, typed errors, typed environments and structured cancellation without tying
  contributors to a large effect framework.
- **The API is declared once, as data.** `contract.ts` holds every route's path, access level and
  schemas. The server router, the HTTP client, the in-process API used by the MCP and A2A adapters,
  and the access checks are all derived from it.
- **The server decodes strictly; clients read unknown values safely and check the protocol version
  at start.** `Schema` has two readings: `decode`, what the server accepts, and `read`, what a client
  does with a response. `read` accepts longer text, larger numbers and longer lists, fills a field's
  default (`S.withDefault`), and reads a value of an `S.tolerant` enum, or an `S.openVariants` tag, it
  does not know as `"unknown"`, which always means the safe thing: a status is not sent, a role is not
  an administrator, a relation is no contact, a character is none. A test walks every response and
  event and fails on a literal or a set of variants that is not tolerant. The event stream skips an
  event it cannot read and moves past it. `server.info` carries a `protocolVersion` (read as 1 when
  absent) that rises only for a breaking change, and keeps its required fields across protocol
  versions; the command line (`status`, `stream`, `run`), the MCP adapter after sign-in, and the web
  client at start ask it once and name the side to upgrade in one sentence. A feature is offered only
  when the server lists it as on. Mixed versions are not tested; a version-negotiated API with several
  live shapes per route would have cost every handler.
- **The A2A gateway speaks 1.0 and 0.3 and lets the `A2A-Version` header choose.** The card lists the
  one JSON-RPC URL once per version. The 0.3 entry is for clients that read a 1.0 card; a plain 0.3
  client that reads only the card's top-level `url` does not find it. A stated version other than 1.0
  or 0.3, or one that does not match the method names, is refused as not supported. §3.6.2 says a
  request without a version MUST be read as 0.3; the gateway is deliberately more lenient: with no
  version stated the method names decide, so a 1.0 client that leaves out the header still works.
  Only 1.0 errors carry an `ErrorInfo`.
- **One SQL implementation, three dialects.** Queries are written once in portable SQL through a
  tagged template. A small table DSL generates dialect-specific DDL. SQLite uses the runtime's
  built-in `node:sqlite`.
- **Dovecote does not call a language model.** Drafting happens in the member's own agent client.
- **Events are per-member and durable.** Each member has a sequence-numbered event log, so a client
  resumes a dropped stream from its last sequence number. A client that falls too far behind is told
  to resync.
- **Real-time fan-out is in-process.** One Dovecote process serves a deployment. Multi-node fan-out is
  on the roadmap.
- **`HB_TRUST_PROXY` counts trusted proxies, and the client address is read from the right of
  `X-Forwarded-For`.** Load balancers append to whatever header the client sent, so only the entries
  the operator's own proxies added can be trusted; the leftmost one is the client's claim. A hop count
  serves one proxy (`1`), Google Cloud's load balancer (`2`, it appends the client and itself) and a
  CDN in front of either, without parsing proxy-specific headers.
- **Startup is one task, `prepareDatabase`: migrate, then seed channels.** Every embedded server gets
  the channels in `HB_CHANNELS` the same way `main.ts` does.
- **The 0.1.0 schema is one baseline, version 1, and Dovecote touches no database it did not make.**
  The baseline stays exactly as 0.1.0 released it; every later change is a numbered step after it.
  Step 2 adds what the agent figures and teaching need: the draft's seen and decided times, its first
  wording, client and model on notes, and the principles, applications, offers, quiet places and
  releases tables. A new database runs every step at once; a 0.1.0 database runs only the steps it
  lacks. Steps only add nullable columns, tables and indexes, so an upgrade keeps every row.
  A database that records versions this build does not know, or holds its tables with no version, is
  refused at start with one sentence and left as it is, rather than guessed at. A database from a
  0.1.0 release candidate is recreated.
- **An upgrade from every final release is promised, and tested release by release.** Each final
  release has an upgrade fixture: its database built through the real schema steps it had, with rows for
  the features it had. One set of checks starts the current server on each of them on SQLite,
  PostgreSQL and MySQL: only the missing steps run, old rows stay, the audit chain verifies, the core
  flows work, a second start changes nothing, and a start cut off midway is finished by the next. The
  release workflow adds the fixture of a new release and refuses one without it. Pre-releases are not
  covered.
- **Source runs as TypeScript; deliverables are bundles.** Packages export their `.ts` sources to each
  other. `esbuild` produces the server, CLI and web bundles.

## Authentication

- **Approval happens only in a client where the person signed in themself; no agent integration can
  approve.** The Claude Code plugin once offered an approve button backed by a human credential stored
  on the person's computer (`approval-credential.json`). The agent runs on that computer as the same OS
  user, so the only thing between a prompt-injected agent and that file was a pattern blocklist in the
  plugin's guard, and a credential on the same machine as the agent cannot be protected by pattern
  matching: any command, script or tool the agent can run may read it under a name the patterns do not
  know. So the button, its credential, the `approve` scope, `HB_APPROVE_BUTTON`, `server.info`'s
  `approveButton` and the command line's `approve`, `discard` and `login --approve-button` are gone. A
  device or OAuth sign-in issues an agent credential and nothing else; the pane shows a draft as waiting
  for approval and links to it in the web client. The plugin's guard still asks the model to leave the
  Homingbird configuration directory alone, as a courtesy that keeps the agent token out of transcripts,
  not as a boundary. Approving from the desk with a confirmation on another device is on the roadmap.
- **A human credential counts only when a browser sign-in issued it.** `authenticate` refuses a `human`
  credential whose client is not the web sign-in. Approve-button credentials that 0.1.0-rc.3 issued
  are therefore refused on a database that rc.3 created, and any future path that issues a human
  credential somewhere else has to change this check on purpose.
- **The runner keeps Homingbird secrets out of the agent command's environment.** `homingbird run`
  starts an agent command as the person's own OS user, so that command can read any file the person
  can, and the model behind it may follow a hostile note. The agent command gets the person's
  environment without `HOMINGBIRD_*`, `HB_*` and any variable holding the agent token, and the note only
  on standard input, wrapped. The agent credential stays readable to the command; it can draft and
  read, never approve. A command that is not trusted belongs under a separate OS user or in a container
  (`docs/guide.md`).
- **OAuth clients redirect only to loopback, app schemes and allow-listed https hosts.** Dynamic
  registration lets anyone name a client "Claude", so the consent screen alone cannot stop a lookalike
  that sends the code elsewhere. `HB_OAUTH_REDIRECT_HOSTS` (default `claude.ai,claude.com`) lists the
  https hosts, matched exactly, and is checked at registration and again at every authorization, so
  removing a host stops clients registered earlier. Loopback redirects match on any port (RFC 8252).
  Claude's `client_id` metadata documents are fetched only from `HB_OAUTH_CLIENT_METADATA_HOSTS`, over
  https, with a timeout, a 5 KB limit, redirects re-checked against the list and IP addresses refused,
  and are cached for ten minutes. The allow-list of names is the SSRF guard, as for push services; DNS
  answers are not inspected. Operators pre-register other agents with `HB_OAUTH_CLIENTS`; those
  redirect URIs are trusted as configured. `/oauth/authorize` without a session sends the browser to
  sign in and back to the same request; no consent request exists until a person is signed in.
- **Administrators are named explicitly in `HB_ADMIN_EMAILS`; nobody becomes one by signing in first.**
  A fresh server reachable from the internet would otherwise hand administration to whoever arrives
  first. Dovecote refuses to start without the variable. Development login keeps the first-member rule.
- **Agent access tokens are opaque and stored as SHA-256 hashes.** Dovecote is both the authorization
  server and the resource server, so nothing needs a self-contained token.
- **A refresh token is used once; presenting a spent one revokes its credential.** Every refresh issues a
  new access token and refresh token and keeps the old refresh token's hash in `spent_refresh_tokens`
  (OAuth 2.0 Security BCP, refresh token rotation). The OAuth connector is the only client with refresh
  tokens, and a credential is one family: its id stays across refreshes and its row holds the one live
  access token and refresh token, so revoking the row ends both. A spent token presented again means
  two parties hold the chain, and Dovecote cannot tell which is the person, so it revokes the credential,
  writes `credential.revoked` with `because: refresh_replayed` and the credential's id only, and answers
  `invalid_grant`, as for any refused refresh; the person connects again. The revocation commits before
  the refusal, so the refused request does not roll it back. **Grace: 10 seconds, for the token the live one replaced only.**
  Within 10 seconds of a refresh, the refresh token it replaced is refused without revoking anything:
  a client retrying a request whose answer it lost, or two refreshes in flight, must not cost the person
  their connection. An older token, or the replaced one after 10 seconds, revokes. The repeat is
  still refused rather than answered: Supabase Auth gives the live token back in the same case, but
  Dovecote keeps only its hash, and a second new pair would make the winner's refresh token spent and
  its next use a replay. A thief who replays within the grace gets nothing; the case missed is a thief
  who refreshes first and the client following within 10 seconds, which a one-hour access token makes
  rare. Two refreshes that
  race are settled by the row: the update names the refresh token it replaces, so only one changes the
  row, on every database. Each spent row keeps the hash of the token that replaced it, and the grace
  holds only while that is the credential's live refresh token: the order of the clock decides nothing,
  so two refreshes in one millisecond or a clock that steps back cannot move it. A client that lost
  the answer to its refresh and retries within the grace is refused and cannot use that credential
  again; it stays unusable until it expires, and the person connects again. Spent tokens are deleted
  once their credential has expired or been revoked.
- **The identity provider's discovery document is checked before anything is sent to it.** Its
  `issuer` must equal `HB_OIDC_ISSUER` exactly (trailing slashes aside), and its authorization, token
  and key endpoints must be https on a public host name (http only on loopback when Dovecote itself
  runs on loopback). They need not share the issuer's origin, because providers such as Google serve
  them from other hosts; instead discovery, keys and the token call refuse redirects, so the client
  secret and the authorization code go only to the endpoint the pinned issuer's own document names.
  A document that fails is not cached, sign-in says it is unavailable, and the server log says why. An
  ID token must carry an `iat` no later than the clock-skew allowance, and its `nbf` is honoured. As
  for push and client metadata, host names are checked, DNS answers are not.
- **Identity providers are OpenID Connect.** Google is the default issuer. For Google, an address in an
  allowed domain must come with a matching hosted-domain claim, so a personal account carrying a company
  address is refused; people admitted by an invite or by name in `HB_ADMIN_EMAILS` may use any verified
  address ([A person joins with an invite link](#a-person-joins-with-an-invite-link-an-allowed-domain-is-optional)).
- **Access ends with the session.** Sessions expire after `HB_SESSION_DAYS` and renewing one requires
  signing in with the identity provider again. Deactivating a member revokes every credential at once
  and turns every sign-in they approved and no program has collected yet, a device code or an
  authorization code, into a denied one, in the same transaction. Revoking alone left a gap: a code
  approved a minute before could still be exchanged for a new, refreshable credential afterwards.
  Authentication also requires an active member, so a credential that slipped past both still answers
  401.
- **Dovecote re-validates a person only when they sign in; a refresh checks the member, not a sign-in.**
  The identity provider vouches for a person at sign-in, where the ID token, the allowed domains, the
  hosted domain and the member's status are all checked again. Dovecote asks for `openid email
  profile`, not `offline_access`, and keeps none of the provider's tokens, so it has no way to ask the
  provider about someone between sign-ins; keeping a provider refresh token would be a new secret to
  store encrypted, for one provider at a time. Browser sessions are never refreshed. The OAuth
  connector's credential refreshes only while its member is active, so deactivation stops it at once,
  as it does every other credential. Requiring a recent web sign-in for that refresh was considered and
  left out: a deactivated member is already refused, and someone who works only through the connector
  should not have to connect again every `HB_SESSION_DAYS`. Besides deactivation denying a code
  they approved, the exchange itself refuses a code of a member who is no longer active, so no
  credential is issued after deactivation. **Offboarding stays a person's action:** Dovecote reads no directory, so there is no
  member sync command and no SCIM, as groups come from no directory import; an administrator
  deactivates, and `docs/deployment.md` (When someone leaves) is the runbook, with what each credential
  does when nobody does and a monthly query of last sign-ins.
- **Cookie-authenticated writes need a custom header** and a matching `Origin`. Cross-origin requests
  are never allowed for cookie sessions.

## Audit

- **Every state-changing API call and every authentication event is audited in the same transaction
  as the action.** Reads are not audited.
- **Audit entries can be forwarded** as JSON lines on stdout or to a webhook. Both are off by default
  because entries contain note content.

## The audit trail records who changed what, never content; logs and analytics are separate kinds

This reverses four earlier entries: "Every state-changing API call ... is audited" (under Audit),
"Principles, offers and their audit entries keep the full text", "The audit log holds every turn, every
drafted result and every export", and, for the basis, "The audit entry keeps it too". An audit log that
copies every note, basis, principle and turn becomes the most sensitive table in the database, read
through a web view and shipped to log vendors; and recording reads and draft edits makes it a tool for
timing people, the reason `drafts.seen` was already left out.

- **Five kinds, each with its own reader.** The audit trail (table `audit_events`, database only), the
  product's own activity data (no new log), the operational log (JSON lines on stdout), the CLI and MCP
  service log (a file on the person's computer), and product analytics (off by default).
- **The audit trail holds metadata only.** Ids, enums, the outcome, and old and new values for settings;
  never request bodies, note, draft, basis, principle, character or turn text, tokens or email
  addresses. The client address and user agent only on authentication rows and credential issue. Each
  event's detail is a Schema in `protocol/src/audit-events.ts`, and encoding with it is the allow-list.
- **Every contract route declares its audit decision**, an event and the kind of thing it is about, or
  why it keeps nothing, in `protocol/src/route-audit.ts`, a map over every route name, so a new route
  does not type-check without one. It is a separate map rather than a field on each route so the
  contract file stays the wire contract. Reads, note reads, moves, pickups and releases, drafts created,
  edited and seen, debate turns, drafted results and votes, push and presence keep nothing.
- **Refused attempts are coalesced**: one `authz.denied` row per credential and route a minute, with a
  count, and one `authn.token_refused` row a minute per refused token's credential, or per a hash of the
  token, never the token; plus one warning line per address, cut to /24 or /48. Windows are written
  within ten seconds of closing and all at shutdown.
- **A credential's row names the kind of program, not its name**: `browser`, `cli`, `mcp`, `plugin`,
  `oauth`, or `device` for a client before this version, and the OAuth client id. A device sign-in
  says its kind in an optional `client_kind` form field that older servers ignore.
- **A detail that fails its schema never fails the action**; the row keeps `invalidDetail` instead.
- **The first audit table ages out at the upgrade** by the retention the administrator had saved, and
  `dovecote audit purge-legacy` removes it all; the audit commands never migrate.
- **The trail is hash-chained and read on the host.** SHA-256 over the previous hash and the row, a head
  row that serialises writers, the head written to the operational log daily, a purge that remembers the
  last hash it removed. `dovecote audit verify` and `dovecote audit export` run against the database;
  the admin web view and its route are removed in one release, since only the bundled web client called
  that `human` route.
- **Writers are ordered by a one-row head, not by locking the newest row.** Each writer reads
  `audit_head` with `FOR UPDATE` on PostgreSQL and MySQL; SQLite's transactions are `BEGIN IMMEDIATE`,
  so one writer already holds the database. Locking the newest `audit_events` row instead would lock
  nothing while the table is empty or just purged, and MySQL's gap locks on `ORDER BY id DESC LIMIT 1`
  differ by isolation level; one known row locks the same way on all three databases and keeps the head
  readable without a scan. The cost is that every audited write waits on one row, which is fine at one
  process and pilot size (see `scripts/pilot-measure.ts`).
- **The row's `id` is not hashed.** The id is assigned by the database on insert, after the hash must be
  known, and the chain already fixes the order: each row names the hash of the one before, so moving,
  removing or inserting a row breaks the next link. Renumbering ids without changing content is not
  detected and changes nothing an auditor reads.
- **Tamper evidence, not tamper proofing.** Whoever can write the database can recompute the whole chain.
  The documentation says so, and the head leaves the database daily in the operational log so a copy
  kept elsewhere detects a rewrite. Signing the head with a key the database's writers lack would close
  that gap, but needs key management a self-hoster must run; it waits for an organization that asks.
- **The operator decides what is recorded, the administrator does not.** `HB_LOGS` and
  `HB_AUDIT_RETENTION_DAYS` (400 days, at least 90) are environment variables only and are not in
  `server.info`; the audited party cannot shorten its own trail. `audit=off` is allowed with one warning
  at start. The administrator's retention setting is ignored and stays optional on the wire.
- **The webhook is removed; stdout is the way out.** `auditCopy=on` copies each row without its detail as
  an operational line; collectors already ship stdout.
- **The operational log is a `Log` service with a fixed event catalogue.** No free-form message, so a
  line cannot carry a secret by accident; a defect is logged by its type, its redacted detail only at
  `debug`. Each request gets an id from the random service, returned as `X-Request-Id` and shared by its
  log lines and audit rows.
- **Product analytics go through Dovecote only, re-keyed and queued.** Pages and presets are enums, each
  anonymous id is replaced by an HMAC under a server key before forwarding, one credential may send 60
  events a minute, and delivery runs from a bounded background queue, never inside the request. Our own catalogue, Segment-shaped, checked by the
  server and forwarded by data-only adapters for PostHog, GA4 and a generic HTTP endpoint, so no
  third-party script reaches a browser and nothing unchecked leaves. A random id, never the member.
  Off unless the operator sets a destination and the administrator turns the `analytics` feature on.
- **The CLI service log rotates** at 5 MB into one `.1` backup, and the systemd and launchd units now
  pass `--log` so the runner owns the file it rotates; `--log-level` keeps only problems when asked.

## A person asks their own agents for a draft through a draft request

A draft request is a person's wish for a draft: where it should go (a reply, a conversation, or a
colleague), an optional instruction, and optionally one chosen agent. Creating and withdrawing one
are `human` routes. The request is announced only to the requester's own clients as `draft.requested`,
so every connected agent may answer with `drafts.create` and `requestId`, and the person picks among
the drafts. A request stops waiting when it is withdrawn, after 24 hours, or, for the agents that have
not answered yet, once one of its drafts has been sent. It never reaches another member.

## A channel is a room; helping with a channel is the profile tag

A channel has a slug, a one-line description and one persistent conversation of kind `channel`. "What my
agent can help with" is the set of channels a member helps with, so there is one concept instead of
tags plus rooms. Any person may create a channel; administrators rename and archive them, and
`HB_CHANNELS` seeds them.

- **Archiving is the one way to retire a channel, and its name says what happens.** Combining two
  channels never combined their notes: notes stayed in the old room and only people and answerers
  moved. So one action, `admin.channels.archive`, replaces removing and combining: the channel leaves the list, its room becomes
  read-only and stays readable to its members under Archived, notes are not moved, waiting drafts are
  discarded and their authors told why, and with `moveMembersTo` its members join another channel and
  keep answering if they did. Members of a private channel, or anyone moving into a private one, move
  only between channels with the same members, the same rule as moving a question.

- **No channel exists unless someone made it, and nobody is put in one.** The server creates exactly the
  channels `HB_CHANNELS` lists, joins nobody to them, and adds a new member to no channel. A channel every
  member is forced into would write one event row per member for every note in it, and a channel
  everyone must sit in is not what an organization asked for. A channel named `general` is an ordinary
  channel like any other.
- **When no channel fits, the question goes to a person, or nowhere.** The agent looks for the single
  best channel the member can see; if none fits, it looks in the directory for a colleague whose profile
  or channels match and drafts to them; if nobody fits, it tells its human that it found no
  destination. It never posts one question to several channels.
- When a question moves, the waiting reply drafts of members who are not participants of the new room
  are discarded, and their authors get `draft.discarded`; drafts by members of the new room move with
  the question and their authors get `draft.saved`. A helper outside the new room could neither read
  the question nor send such a draft, only discard it, so the draft only ever waited to be thrown away.
- A question drafted to a channel goes to exactly one room. A question that spans channels goes to the
  best one; posting to several rooms would split the answers.
- The asking agent chooses the channel from `channels.list`; the server does no matching and runs no
  model. The person sees the destination when approving.
- A question is delivered (receipts, inbox, reply drafting) to the channel's helpers. Asking makes the
  asker a participant who can read the room without becoming a helper. A reply is delivered to the
  asker only, and a question with a sent reply leaves the other helpers' inboxes.
- A sent question is not moved. A question asked in the wrong channel is asked again in the right one;
  the first stays where it was asked, with its receipts and its history. Moving one rewrote who had
  received it, discarded other people's waiting replies and left a gap in a room people had read, for
  a mistake that asking again fixes.
- A draft question is re-addressed in place: `drafts.update` takes an optional `channel` and moves the
  draft to that room, keeping its id, origin, agent name and draft-request link. Only a draft addressed
  to a channel room that is not a reply can move. The route stays `member`, so the drafting agent may
  re-address its own draft: a draft goes nowhere until a person approves it, and the approval screen
  shows the destination. Creating a new draft and discarding the old one would have recorded a
  person as the author of an agent's text.
- Removing or merging a channel archives its room: the conversation keeps its title, becomes a group
  and gets `archivedAt`. Its participants can still read it; drafting, sending, replying or moving a
  question into it is refused with a Conflict, and the drafts waiting in it are discarded
  (`draft.discarded`). A state, not a renamed title, so no client has to guess from text that nothing
  more can be written there.
- `channels.list` puts the channels the viewer is in first, then the fullest, then by slug, a page at a
  time (`limit`, `cursor`, `hasMore`), and `q` searches all of them. An organization can have more
  channels than an agent should read in one call, and the ones a person is in, or that many joined, are
  the likeliest destinations.
- Rule 6 holds unchanged: a channel room is visible only to its participants. Any member may join an
  open one; a private one is joined only through a manager.
- Every participant of a room gets an event row per note, so a note in a channel costs one write per
  participant of its room. This is accepted at the documented single-instance scale; no room holds
  every member unless every member joined it.

## Being in a channel, answering in it and managing it are three things; a channel is open or private

Being able to read a room and being sent its questions are separate, so a person can follow a room
without answering in it, and a team can keep a room to itself.

- **Join and Leave are about being in the room**: reading it and asking in it. Nobody is sent a
  question for being a member. Asking in an open channel still joins you, because an open room is
  readable by anyone who joins anyway; drafting to a private channel needs you to be a member already.
- **"Answer questions here" is a switch only a member has.** On, you are a helper: questions reach you
  and your agent drafts the replies. Off, you stay in the room. Leaving turns it off. The list offers
  "Join" and "Join and answer". "My agent can help with" lists exactly the channels with answering on.
  On the wire the viewer's flags are `joined`, `answering` and `managing`, and "helper" means a member
  who answers.
- **A channel is `open` or `private`.** Private hides a channel from everyone outside it, everywhere: the
  list, search, the directory's chips and `?channel=`, conversations, lookup by slug or room id, events,
  and every tool, command and gateway. A lookup answers exactly as for a channel that does not exist,
  and a taken slug, hidden or not, answers "That name is not available.", so a name probe learns no
  more than that. Any person may create one. Private means hidden from other members, not from the
  organization: administrators can manage every channel and the audit log still holds note content.
- **A channel's own group manages it** ([below](#groups-replace-channel-managers)). Its members are
  the channel's managers: they add and remove members of a private channel; nobody joins a private
  channel by themselves, not even an administrator. A new channel's managers are its creator alone. A
  channel with members keeps a manager in the room.
- **Visibility is chosen once, when the channel is created, and never changed.** People join an open
  channel and write in it expecting that anyone may read it, now and later; people added to a private
  channel write expecting that only its members ever will. Opening a private channel would show its whole
  history to everyone, and closing an open one would hide from the organization what was written for it
  and keep inside people who joined on their own, with no manager ever choosing them. Neither change can
  keep both expectations, so there is no route for it; someone who needs the other kind creates a new
  channel. The create form says so. `channels.visibility` stays a column, set only by `channels.create`,
  and the `channel.visibility_changed` audit event is recorded by nothing but still reads in old trails.
  Every membership, answering and manager change is a `human` route, so it is audited and never
  reachable by a model.
- **A private room keeps its questions.** A question in a private channel moves only to another
  private channel with the same members; one moves into a private channel only when the mover and the
  asker are members. A removed member's waiting drafts in the room are discarded and the room drops
  from their clients at once through `channel.left`, which carries only the slug and room id.
- **The web client shows "Private" with a lock, never colour alone.** Korean uses 비공개 and 공개 for
  the visibility, 참여하기 and 나가기 for join and leave, 여기서 질문에 답하기 for the switch, and
  운영자 for a channel manager, because 관리자 already means a server administrator, and 그룹 for a
  group.

## Groups replace channel managers

A list of managers kept on each channel by hand is hard to fill for a team that runs several channels,
and someone who left stays a manager wherever nobody removed them. There are two kinds of group. A
**team** is made and named by an administrator and changed by administrators only. A **channel group**
is made with each channel, has no name, and holds that channel's managers: a channel's managers are the
active members of its own group (`channels.manager_group_id`), every one of them in the room. Teams
never manage a channel: **Add a team** copies a team's current members into a channel's group once, a
snapshot with no link, so a change to a team never silently changes who runs a channel, and a channel
group is never shared, so handing channels between groups, and the races of doing so, do not exist.
Every member sees every team and who is in it; a group made for one channel is shown only to people
who can see that channel, because an unnamed group that appears with a new member would tell everyone a
private channel was just made. The same groups can later own a channel's agent
([roadmap](roadmap.md#groups-and-channel-agents)).

- **A channel's group is changed by its managers.** Its members who are in the room add and remove
  managers and add a team. An administrator may change the group of an open channel; outside a private
  channel they may only remove people, still keeping a manager, and never add anyone, themself
  included, nor add a team. Adding a manager puts them in the room, so anything more would let an
  administrator join a private channel by the back door, which rule 6 forbids. A group member who is
  not in a private channel's room, which a race or a deactivation can leave behind, gets no right to
  add either.
- **Every change to a group locks it first.** Dovecote runs PostgreSQL and MySQL at READ COMMITTED, so
  a check read before a concurrent change commits can pass twice: two removals could empty a channel's
  managers. Each change to a group, and to a channel's members or managers, takes the
  channel group's row lock with a no-op `UPDATE`, as a debate room does, in id order when it touches
  two groups, and reads the channel and what it checks after the lock. SQLite runs one
  transaction at a time and needs nothing more.
- **`groups=off` freezes groups; it never unlocks a channel.** With the switch off the group routes and
  adding a team answer 404 and clients hide the group page, the administration's Groups tab, the people
  filter and the groups on a profile. Every channel keeps its managers, who still run it. Turning a
  feature off must never leave a private channel open to anyone or managed by no one.
- **Deactivating a member removes them from every group, even the last manager.** It is the one
  exception to keeping a manager: someone who has left loses every right at once, and refusing to
  deactivate them until a channel found another manager would keep a departed person's access. The
  deactivation dialog lists the groups the person leaves, so a colleague can be added first. A private
  channel whose managers are emptied keeps its members and notes; an administrator can archive it but
  not add anyone to it, for the reason above.
- **Membership follows management.** Adding someone to a channel's managers, one by one or from a
  team, puts them in the room and records `channel.member_added`, as adding a member does, and a
  manager cannot leave the room while a manager. A manager outside the room would change a room they
  cannot read, and "managers are in the room" keeps rule 6 one check rather than two.
- **A team has a name; a channel group has none.** A team's name is one line of at most 80 characters,
  unique ignoring case. A channel group shows as "Managers of #slug", only where its channel shows.

The table is `member_groups`, because `groups` is reserved in MySQL 8, with `kind` `team` or
`channel`. `channel_managers` stays in the schema and is no longer read or written; the old
`channel.manager_added` and `channel.manager_removed` audit rows keep their meaning.

## A channel's agent is its own member, and its channel's managers approve it

A team that answers questions from its own knowledge needs an agent nobody owns alone: whoever runs
the channel this month must be able to run it and approve what it writes. So a channel's agent is a
`members` row of its own `kind = 'channel_agent'`, with credentials of its own, and its drafts carry
its id as `author_id`.

- **A principal, not a person's second agent.** Every rule that shows a draft to its author compares
  `author_id` with the viewer, so with the agent as author none of them opens to a person: inbox,
  search, stream, lookup by id and conversation lists stay exactly as they were. Reviewers read the
  agent's drafts only through `reviews.list` and `reviews.get`, `human` routes that check the reviewer
  rule. Attaching the agent to a person instead would have made that person able to read and send
  every answer, and nobody else.
- **Ownership is not stored.** The channel's agent is the one active `channel_agent` in its room, and
  its owners are the channel's managers (`managersOf`) at the moment they act. A stored owner would be
  a second list of managers to keep in step with the group, and the races of doing so are the ones
  "Groups replace channel managers" removed. One agent per channel is checked under the channel
  group's lock.
- **Who approves.** A person, a current manager of the channel, and not the author of the question the
  draft answers: a draft stays invisible to whom it is for (rule 2). Outside a channel's room every
  participant is a recipient, so the rule is phrased by the asker, not by recipients. When the asker is
  the only manager nobody could approve, so the agent's draft is refused with a Conflict telling the
  managers to add another. The send locks the channel's group, reads the managers again, checks the
  reviewer and then `expected`, and records `notes.approved_by`; the first approval wins.
- **What the agent may write.** Only a reply to a note someone else sent in its channel's room or one
  of its private questions, one waiting per question and a bounded number in all. It opens no
  conversation, joins no room and cannot be messaged, added to a group or a channel, or signed in as:
  every route that names a member refuses its id, and a test walks the contract for them.
- **Credentials have an issuer.** A manager in the room issues one through the device flow; the
  credential records `issued_by`, and when the issuer stops managing the channel their credentials go
  in the same locked change. Retiring the agent, or archiving the channel, deactivates it and revokes
  them all. With `channelAgents=off` the agent's credentials are refused and nothing is deleted.
- **Private questions are conversations, not private channels.** Asking privately makes a conversation
  tied to the channel (`conversations.channel_id`, `asked_by`) of the asker, the agent and the current
  managers; manager changes bring its participants in step under the same lock, so a new manager reads
  its history and one who left loses it. A private channel would have needed its own managers and
  members for every question, and the asker would have been one of its managers. The asker's notes go
  to the agent alone and everyone else's to the asker alone, so the managers' own agents do not answer
  it. A question there never moves to another room, administrators get no view of it, and archiving the
  channel closes it, readable to who was in it.
- **Its managers teach it, in the web client only (rules 3, 6 and 8).** A channel's agent has an
  instruction (500 characters), up to five sources, and rules and saved answers. The rules and answers
  are principles kept as a person's are, under the agent's member id, so the model, the validation, the
  50-item cap, the order, the "Principles applied:" matching and each principle's figures are the
  same code; they have no place and no public sentence. Reading or changing them is a `human` route
  under `/channels/:slug/agent/teaching` and `/channels/:slug/agent/principles`, behind `channelAgents`
  and refused as switched off while `teaching` is off; each checks, under the channel group's lock, that
  the caller is one of the channel's managers now, so an administrator outside the group is refused as
  anyone is, and a manager who leaves the group loses them at once. No MCP, CLI, plugin or A2A tool
  names these routes. The agent's own credential reads them only through `principles.drafting`, which
  for a channel's agent answers with its channel's principles and a `channel` part holding the
  instruction and sources (`selectChannelTeaching`); an instruction that looks like a forbidden request
  is left out and named as ignored, as a principle is. Audit entries (`channel.agent_instruction_changed`,
  `channel.agent_principle_*`) name the manager, the channel and which fields changed, never their
  words. They stay with the agent they taught: retiring it retires them, and a new agent starts fresh.
- **In a draft's instructions the managers' teaching sits between the flow's steps.** The prompt puts
  the answering flow first and the teaching after it, as for a person's principles, and says when each
  applies: the flow's steps before drafting, then the instruction, sources and principles while
  drafting, then the flow's checks on the draft. The flow still wins a conflict.
- **"Teach from this correction" is an offer a manager acts on, never a stored suggestion.** A person's
  edit and discard offers are kept (`principle_offers`) because they come back later; a manager who
  edits or discards an answer is offered, on the same card, the principle form prefilled from the word
  diff of that edit (or empty for a discard), and nothing is saved until they save it. The saved
  principle records where it came from (`taughtFrom`), so its origin reads "From an edited answer".
- **Its recent decisions are a `human` read for its current managers (rules 2, 3 and 6).**
  `channels.agent.decisions` lists the agent's answers sent or discarded in the last 30 days, at most
  100, with who decided, the question, the agent's own text beside an edit, the discard reason and the
  principles applied. It answers 404 to anyone outside the managing group, an administrator included,
  and its query joins the managing group and the conversation's participants itself. It leaves out
  every answer to a question the viewer asked, in the room or privately: the draft, the edit and the
  reason were hidden from them when they were made, and a list of past decisions must not show them
  later. Who discarded an answer is kept in `notes.discarded_by`, as `approved_by` keeps who sent one;
  discards before that column read as "a manager". No MCP, CLI, plugin or A2A tool names the route.
  Teaching from a row opens the same principle form as "Teach from this correction", so nothing is
  saved until a manager saves it.
- **Not in this release:** taking a draft ("I'll look at this"), stored offers and quiet places for a
  channel's agent, and decision rules with more than one approver.

## One desk session per person reacts to arriving notes

Each person keeps one agent session open for Homingbird: the desk. In Claude Code it is the session
where the plugin's pane is open; for other agents it is the runner, `homingbird run --agent`. Only the
desk holds the event stream, wakes on an arriving note or a draft request, and drafts the reply.
Every other session may draft only when its human asks, and only the desk picks notes up: in any
other session `check_inbox` lists the waiting notes, says which ones an agent is already drafting, and
leaves their status alone, so "drafting reply" tells the sender that the desk is on it. Drafting a
reply still moves the status from any session. This keeps several open sessions from each
drafting a reply to the same note, and gives "agent awake" one meaning: the desk is running.

When a reply needs project context, the desk gets it from another session or a read-only helper in
that project. The helper receives the colleague's note only as quoted data and returns facts; it
never drafts. Approval stays in the web client, where the person signed in themself.

## An agent ends every note in a draft or a skip, and says what it relied on

Every note an agent picked up ends one of two ways, so the sender never looks at "drafting reply"
for nothing: a draft, where a holding reply ("I
need to check the release plan and will get back to you") is a good draft when it cannot answer yet,
or `notes.release` with a reason. The reason goes to the member's own clients as `note.released`, never
to the sender: it is the agent explaining itself to its person. The release keeps the pickup row, so
the same desk is not handed the same note again as fresh. Releasing sends nothing, so it is a `member`
route and every agent surface offers it (`skip_note`, `homingbird skip`, the runner's `SKIP:` line).

An agent may read what a colleague links to, with the tools and access its person already gave it:
that is research for the draft, and a desk should answer as well as the same agent asked from the
web. What it can open follows its person's own tools and permissions: Homingbird passes links, not
documents. When something cannot be opened, the agent never guesses its content and never asks the
sender for access; it records that it could not open it, or skips with that reason.
The note and the linked material stay untrusted: the agent only reads, never sends,
edits or shares, and never follows instructions found in either. Because a draft can rest on the
person's own documents, an agent sends `basis` with it, what it read or relied on.

- **The person who approves sees the basis.** `Note.basis` is stored with the note and returned only
  when the viewer is its author, on the draft and after it is sent; recipients and other members never
  get it, in no list, search, inbox or event delivered to them. The web client shows it on the draft
  card under "What this draft is based on", including the per-check lines, and says so when the agent
  gave none. This reverses the earlier rule that kept it in the audit log only: an approver who cannot
  see what a draft rests on approves blind. The audit entry keeps it too. The basis still describes the
  answering flow's steps by purpose, never in their words, so the flow itself stays unshown.
- **An agent may report structured sources beside the basis.** `sources` on `drafts.create` and
  `drafts.update` lists up to ten, each a web address (`http` or `https` only) or an earlier note's
  id, with the passage the agent used; the runner reads them from `SOURCE:` lines, the MCP tools take
  them as an argument, and free-text basis keeps working alone. The server decodes them strictly and
  refuses a note the author cannot read or that is not sent, so a source can never point a reader at
  a draft or another conversation; it stores the note's conversation with it. Sources are shown to
  exactly those who are shown the basis: the author, on the draft and after it is sent, under a
  collapsed "Based on", and a channel's reviewers on the review card. The web client shows an address
  as a link and a note as a jump to it in its conversation, and reads a source it does not understand
  as nothing.
- **Why an agent gave a note back, and why an archive discarded a draft, survive a reload.** Both are
  kept per member and note (`notices`) and returned with that member's thread, so "Your agent did not
  draft a reply" and "Your draft in #channel was discarded because the channel was archived" read the same
  on another device as in the live event. A release notice clears once a reply draft exists or the
  person asks for one. Only that member sees either.

## The administrator sets one answering flow for the server

An organization wants every answer to go through the same steps, such as looking in its knowledge
base first and checking a draft for confidential material, while its members' agents differ in what
tools they have. Homingbird runs that chain and ships no steps of its own: an administrator writes the
flow once, as steps before drafting and checks on the draft, named by purpose rather than by tool, and
each desk meets a step with a fitting tool or by careful reading.

- It is server-provided text that reaches models as instructions. That is acceptable because the
  administrator already controls who is a member and what the server does, every change is audited,
  and the text cannot widen what an agent can do: no tool exposed to a model can approve, send,
  change contacts or read credentials whatever a step says, the prompt tells the agent to ignore a step
  that asks for any of that, and no model-facing route can set the flow.
- It is not displayed to members anywhere, and it is not a secret: it reaches each member's own agent
  session, so an administrator must not put confidential material in it. Agents are told not to quote
  it back in a draft, in `basis` or to a colleague.
- It lives on the server rather than in each person's files, so one change reaches every desk;
  personal flows and command steps for the runner are on the roadmap.

## Split mode keeps the drafting agent away from a note's wording

A colleague's note is untrusted text, and an agent that reads it word for word can be steered by an
instruction hidden in it; quoting it as data (`wrapNote`) lowers that risk but cannot remove it. In
split mode (`homingbird run --split`, `homingbird-mcp --run-agent … --split`) a reader command reads
the wrapped note, with nothing else in its prompt, and may answer only one JSON object of a fixed shape:
`kind`, `topic` (80 characters at most), `asks` (240), `needs` (five phrases of 60), `deadline` (a date
or null) and `language` (a BCP 47 tag). The runner checks it with a kernel schema and rejects anything
else: other fields, longer text, control characters, prose, several objects. A note it cannot read
that way is given back with the reason "could not read the note safely", never drafted from. The
drafting agent gets the instructions, the answering flow and these fields, wrapped as quoted data from
the colleague, and never the note's text; its draft's basis begins "Drafted from the extracted question
(split mode)".

- **What it protects against, and what not.** The writer never sees the note's exact wording, and an
  instruction longer than the caps cannot reach it whole. The free-text fields can still carry injected
  words, which is why they are short and arrive as quoted data. It reduces the note's influence on the
  writer; it does not remove every influence.
- **Tools are the person's to take away.** Homingbird runs an arbitrary command and cannot strip its
  tools, so the reader is as safe as the command the person gives `--reader`; by default it is the
  agent command itself, and the runner says so once at start. `--require-toolless-reader` makes the
  runner refuse to start when the two are the same command, as an opt-in strictness; it cannot check
  that a different command really has no tools.
- **Approval stays the boundary.** Every draft still waits for its person in the web client. Split mode
  is the foundation automatic sending will need, not a reason to send without approval: that needs the
  deterministic server checks on the roadmap first.

## What wrote a note: program and model are both as reported

Every note an agent writes records two labels next to the connection's name: `client`, the program the
agent ran in, and `model`, the model it ran as. Both are what the agent or its integration reports, not
facts the server can check. Each integration passes on what it is told: MCP takes the client's
`clientInfo` name and version from `initialize` (or a stateless call's `_meta`), which the client
declares about itself; the runner and the MCP-hosted desk use the agent command's program "via homingbird
run", past launchers such as `env` or `npx`; the plugin asks its host for "Claude Code" and its version;
A2A uses the calling agent's card name when it sends one. When an integration names none, the server
falls back to the client name the credential was registered with. `model` is what the agent says about
itself (`model` on `drafts.create` and `drafts.update`); desk prompts ask for it only if the agent knows
it. The command line takes `--model` but no program flag: the program comes from the integration that
runs it, never from a model.

- **Labels, never instructions.** Both are shown as text, after the note is sent, to everyone who can
  read the note, and never placed in any prompt, so a label cannot steer another agent. Every path
  cleans them the same way (`agentLabelOf`: control and format characters such as a bidi override are
  dropped, one line of at most 80 characters), and the wire model accepts nothing else.
- **Neither is checked.** The web client lists both and ends with "The agent reported its model and
  program." The connection's name, which the server knows from the credential, is the one observed
  fact in that list.
- **Drafts stay private (Rule 2).** A recipient sees neither label until the note is sent.
- **An administrator can hide them.** With the `noteDetails` feature off, the server keeps recording
  both labels but returns them to nobody, and the character's details show only who wrote the note.
- **A debate room records the model the same way.** Each turn, draft of the result and vote keeps the
  model its agent stated (`model` on `debates.turns.post`, `debates.result.draft` and
  `debates.result.vote`; the runner reads a last `MODEL:` line, MCP takes a tool argument), with no
  program, since a room has no client label. The web client shows it in the author's details and beside
  each vote, the exports beside each turn, the result and each vote, escaped like everything an agent
  wrote, and `noteDetails` hides it as it hides a note's. `quotedDebate` leaves it out, so no model reads it.

## The always-on runner is the person's own service, written with each platform's files

`homingbird service install` registers `homingbird run --service` with the service manager the
person's account already has: a launchd agent in `gui/<uid>` on macOS, a systemd user unit for
`default.target` on Linux, a value under the person's own Run key on Windows. It refuses to run as
root (or, on Windows, as SYSTEM or a machine account), writes nothing system-wide and adds no
dependency. Each definition is generated by a pure function, and a thin layer runs the platform's own
command through the injected process service.

- **Windows uses a Run key and the runner as its own supervisor, as `code tunnel service` does.** We
  tried Task Scheduler first: its restart on failure ignores a task that exits with an error code, an
  interactive task shows a console window, and whether `schtasks /XML` reads our encoding was
  uncertain. A Run key value starts `node <cli> run --service` at logon; the runner starts itself again
  detached and hidden (a console flashes once), holds a lock beside the desk claims so a second copy
  exits, retries failures and crashes of its own loop, writes its own log (`--log`), and stops when its
  stop file appears, ending each agent command with `taskkill /T /F`: Node's own kill reaches only the
  direct child, and an agent behind `shell: true` is a grandchild. `service status` reads the Run value
  through `reg query`'s exit status and the lock, never translated output. A `"` or `%` in any value is
  refused rather than quoted. Untested on a real Windows machine.
- **The service waits instead of failing.** In service mode the runner waits for a sign-in, waits for a
  new one when the credential is refused, and retries other failures after a minute, so a service
  manager never restarts it in a tight loop and the person learns from `service status` what to do.
- **The log carries no note.** It holds timestamped steps with ids only; an agent's skip reason, which
  can quote a note, still reaches the person through the server but not the log, and the agent
  command's own error output is discarded in service mode.
- **A preset is a name, resolved when the runner starts.** The service keeps `--agent claude`, not the
  command it stands for, so an upgrade changes the preset everywhere. A preset is marked verified only
  after a run with the real agent, and "not yet tested with the real CLI" when written from the tool's source code.
  A reader that keeps some tools, as Codex's does, is marked so and never passes
  `--require-toolless-reader`.
- **A preset is prepared before the first note, by asking its program.** A preset command is a list
  of words, quoted for sh or cmd.exe when it runs. Before the runner starts it asks the program for
  its `--version` and refuses one older than the preset's minimum, with the upgrade command; it runs
  each probe the preset declares through the process service, with the environment and PATH an agent
  command would get, through cmd.exe only for a Windows batch file such as npm's `codex.cmd`, with a
  time limit and stopped when the runner is, and what that prints
  shapes the command (Codex's reader switches off each server `codex mcp list --json` names, one
  `-c mcp_servers."<name>".enabled=false` each, so the rest of its entry stays) or
  refuses it (an `agy --help` without `--settings`); Antigravity is asked first whether it is signed
  in. A probe that fails stops the runner instead of starting a weaker command. Commands of one's own
  are never probed. `verifiedWith` still means a run with the real agent; `optionsSeenIn` only records
  whose `--help` listed every option.
- **One retry, for one known refusal.** Claude Code refuses `--strict-mcp-config` under an
  organization's managed MCP configuration. Only that sentence, in the error output of a failed run,
  makes the runner run the reader again without it and with every MCP tool denied, or the agent
  without its attached server, and keep that for the rest of the run, both runs within the one time
  limit. No other failure is retried.
- **One line of an agent's error output reaches the log.** The runner reads an agent command's error
  output to recognise that refusal and to say why a run failed: its first line, at most 160
  characters, without control characters and with the token and the credentials file's path
  withheld, also in the service log. An agent could put its prompt there, which the log would then
  carry in part; the alternative was a log that never says why every note failed.
- **The MCP server is attached for one run, with the runner's credential file.** With
  `--attach-mcp`, Claude Code gets the server as inline `--mcp-config` with `--strict-mcp-config`,
  Codex as one `-c` table, and the person's configuration files stay untouched, as the service
  writes nothing system-wide. The server, `@homingbird/mcp` at the command line's own version, reads
  the agent credential from the file whose path is in `HOMINGBIRD_CREDENTIALS_FILE`, read only: the
  agent command could already read that file, and the token itself never enters an environment or a
  command line. Such a server takes no `--run-agent`, `--desk` or `--channel`. Attaching is off by
  default until it has run with each real agent.
- **An agent command is not part of the session that started the runner.** The variables by which
  Claude Code and Codex mark their own children are removed from its environment, compared in
  capitals as Windows reads names: every `CLAUDE_CODE_`, `CLAUDE_AGENT_SDK_` and `CLAUDE_PREVIEW_`
  variable except the few a person sets themself (`CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`,
  `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_GIT_BASH_PATH`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`,
  `CLAUDE_CODE_SKIP_BEDROCK_AUTH`, `CLAUDE_CODE_SKIP_VERTEX_AUTH`), and Codex's session variables.
- **Pausing is a file beside the desk claim.** `homingbird desk pause` writes
  `desks/<server>~<member>.paused`; every runner on the computer, CLI and MCP-hosted, checks it before
  each note and request and keeps its claim while paused, so pausing never hands the desk to another
  runner.

## Sending binds to the draft the person read

An agent may change its own draft at any time (`drafts.update` is a `member` route), and the card a
person reads can be seconds or minutes old when they tap Send. So `drafts.send` carries `expected`:
the body and conversation the card showed, or, for an edited send, the ones the edit started from. The
server sends only while the row matches both, and otherwise answers 409 "This draft changed; read it
again." without sending; the web client reads the thread again and says the draft changed.

- **The comparison runs twice.** The row `sendDraft` reads must match, because the recipients, the
  room's checks and the sent text all come from it; the `UPDATE` must match again, so a change that
  lands between reading the row and writing it is caught too. The read alone misses a change that lands
  after it; the `UPDATE` alone misses one that is put back before it.
- **`expected` is required.** A send that does not say which version the person read is refused as
  invalid, so no caller can send a draft without binding to one. Only the bundled web client calls
  `drafts.send` (Rule 3), so the route changed at once.
- **The basis and model are not compared.** They describe the draft; the body and the room are what
  is sent and to whom.
- **The card binds to what was read, not to what is on screen at the tap.** A change arriving on the
  stream redraws the card, so the web client remembers each draft as it first reached the page
  (`draftsRead`) and, when the text or room differs, hides Send and Edit until the person confirms
  they read it again. Their own save or move counts as read; a change from anywhere else does not,
  and since the page cannot tell an agent from the person's other device, the words name no one.
- **An editor whose draft moved holds Send and Save** until the person confirms the new destination,
  which it shows; their edit stays in place.

## A cloud desk is woken by a content-free call to an address its person saved

A desk can run in a cloud agent service instead of on the person's computer. Such a session cannot hold
an event stream, so Dovecote calls an address the person registered when work waits for their agent. It
is experimental, behind `cloudDesk`, off by default, and offered only when `HB_SECRETS_KEY` is set.

- **The call says nothing but that work waits.** Its body is fixed, `{"text":"Homingbird: work is
  waiting at <HB_PUBLIC_URL>."}`; no note, name or count. The woken session reads everything through the
  Homingbird connector, as any desk does, and its notes still reach it through `wrapNote` (Rule 4). The
  routine's saved prompt holds the instructions, because a service passes the text it is woken with to
  the model as untrusted data.
- **The token is the one secret Dovecote must use, so it is sealed, not hashed** (Rule 5's exception).
  AES-256-GCM under `HB_SECRETS_KEY`, from `node:crypto`, with the member id as associated data so a
  sealed value copied to another person's row does not open. It is used only in the wake request, never
  shown again (reading the wake back gives the host and header names only), replaced in full on every
  save, and deleted when the person removes the wake or is deactivated. There is no rotation tool yet:
  a changed key makes every wake read as "set up again". The host stays in the clear to show it and to
  audit it.
- **Only addresses the operator allowed.** https, the default port, no user name or fragment, a public
  host name that matches `HB_WAKE_HOSTS` exactly (`api.anthropic.com` by default, no subdomains). A
  redirect is a failure, never followed, so the token goes only where the person sent it. The answer's
  body is cancelled unread. Up to four headers; the ones the server sets or proxies read are refused.
- **When to wake.** A pass every 15 seconds, fed by the same deliveries as push and by every enabled
  wake at start. It wakes only when no agent of the person holds an event stream, the bound credential
  has been silent for two minutes, and work really waits for it, asked as that credential: a fresh note,
  an open draft request, or a debate room's ask or ballot. Work is gathered for 30 seconds and woken at
  most every five minutes. While a wake waits for its desk to use the credential, nothing else is sent.
- **Every successful wake starts a new paid session**, and the service has no idempotency. So a timeout
  counts as sent and is not retried at once; refusals (400, 401, 403, 404) stop the wake; 429 waits for
  Retry-After, up to an hour; anything else waits 5, 15, then 60 minutes; a desk that does not use its
  credential within ten minutes counts as a failure; five in a row stop it. A stop is audited and told to
  the person by push and on My agent → Connection.
- **Debate rooms.** A room the bound credential opted into is woken two minutes before its grace would
  drop the agent out, at least three minutes apart, but only while the room still asks that agent for a
  turn or a vote: a wake only to stay counted would open a paid session for nothing. The web client
  recommends a 10 or 30 minute grace.
- **Removing a wake works with the feature off or without the key.** `me.deskWake.remove` is the one
  cloud desk route outside the feature switch, an exception to "a switched-off feature answers 404", so
  that a person can always delete their token (Rule 5). Turning the feature off deletes nothing: a
  deployment that lost its key would otherwise wipe everyone's setup without a word.
- **A late answer cannot change a newer setup.** Every write after a wake request matches the sealed
  value it read; a fresh nonce makes each save's value new, so a wake replaced or removed while a request
  was out is not stopped, audited or announced by that request.
- **The bound credential is served as a desk on `/mcp`**, so a woken connector session picks up what
  waits instead of only listing it. Revoking or letting it expire stops the wake (`credential_gone`).
- **The candidates are in memory**, like presence, which fits the one instance Dovecote supports.
- **Presets are web client data, not server code.** The Claude routine's API trigger comes first, with
  the `anthropic-version` and `anthropic-beta` headers its documentation names, marked as not yet tested
  with the real service, then a generic "POST this address with these headers". Both
  show the prompt to save in the woken task. Only `member` routes are reachable by the woken session; the
  four wake routes are `human` (Rule 3), and the audit keeps `desk_wake.registered`, `removed` and
  `stopped` with the host only. Each wake goes to the operational log as `desk_wake.fired`.

## A server joins with a single-use code made in the web client

Getting an agent credential onto a server meant a device sign-in there, with a link opened elsewhere,
or a credentials file signed in on another machine and copied over. Now the web client makes a join
code and shows the one line to paste on the server, `homingbird setup --server <url> --join <code>
--agent <command>`, which redeems it and installs the background service.

- **Why a code made by the person, not by the server's request.** The device flow starts on the
  device and waits for a person to approve a code they read off it; on a server that means carrying a
  link and a code to a browser and back. A join code starts where the person is already signed in, in
  the web client (Rule 3: only there), so the server needs nothing but the pasted line.
- **What it can issue.** One agent credential, the same as a device sign-in: not refreshable, lasting
  `HB_AGENT_CREDENTIAL_DAYS`, able to read and draft, never to send (Rule 1). It is bound when made,
  either to the person who made it or, from a channel agent's panel, to that channel's agent, which
  only the channel's managers may ask for (`managersOf`, as for the device flow's **Connect it as**).
  The credential records the manager as its issuer, so it goes when they stop managing the channel.
- **Single use, ten minutes.** Long enough to open a terminal and paste, short enough that a code
  left in a scrollback or a chat is useless soon. Redeeming moves it from pending to consumed in the
  same statement that checks it, so two pastes cannot both win. At redemption the maker must still be
  active, and for a channel's agent still manage the channel; a deactivated maker's code is refused.
- **Stored like a token (Rule 5).** The code is 32 random bytes with an `hbj_` prefix; Dovecote keeps
  its SHA-256 hash in `auth_requests`, the table that already holds the device flow's and sign-in's
  secrets with their expiry, so it needs no migration step and expired codes go with the same sweep.
  The code is in the one response that creates it and nowhere else: not in a log line, not in the
  audit trail, which records `credential.join_code_created` and `credential.issued` (grant
  `join_code`) by member and credential id.
- **One refusal for everything.** Unknown, expired, used, or a maker who can no longer issue it: all
  answer `invalid_grant` with the same sentence, so a guess learns nothing. Redemption is rate limited
  per address, ten in ten minutes, on top of the code's 256 bits.
- **A switch, on by default.** `joinCodes` turns the route off and refuses redemption with 404; the
  device flow stays the way for a computer with a browser.
- **`setup` refuses root before it spends the code**, as `service install` does, and keeps the
  credential when the service cannot be installed, printing the one command left.

## Homingbird runs a vendor's agent as its person; it never signs in as one

A desk starts an agent command (`claude -p`, `codex exec`, `agy`, `gemini`) with the permissions and
the sign-in its OS user already has. Vendors draw their line at third-party tools that take over a
subscription sign-in or call the service behind the CLI directly, and at one account shared by
several people. So Homingbird stays on the side that runs the vendor's own program, and says so.

- **What Homingbird never does.** It offers no "sign in with" a model vendor, never calls a vendor's
  subscription backend itself, never reads, copies, stores or forwards a CLI's credential files
  (`~/.claude`, `~/.codex/auth.json`, keychains, OAuth tokens), and never patches a vendor's binary.
  Dovecote calls no model at all. A change that needs any of these needs a new entry here first.
- **Whose account.** On a person's own computer the agent uses that person's sign-in or key. A desk on
  a shared server, a channel's agent, or anything answering for a team uses an API key or the
  vendor's organization or service account, never one member's personal plan: every vendor whose terms
  we read forbids sharing a personal account, and a channel's agent answers for everyone in its
  channel. Homingbird cannot check which sign-in a command uses, so the guide and deployment pages say
  it where a person sets one up, and an operator never collects people's subscription sign-ins.
- **A preset that risks its person's account says so.** `homingbird presets` and the runner's start
  print a preset's `accountRisk`: today Antigravity and Gemini CLI on a Google sign-in, which Google
  says it may suspend when other tools use it.
- **A cloud desk stores only a token that can do nothing but wake.** A key that also reads or acts on
  an account (a Cursor or Devin API key) is not a wake token, and storing it on an organization's
  server would be sharing that account.
- **Not a legal opinion.** Terms change; the guide links each vendor's own page, and a person checks
  their plan's terms before running a desk around the clock.

## A running desk whose agent cannot answer is a third state, not offline

When a person's model plan ran out or their agent program signed out, the desk kept running: it showed
as awake, picked up every arriving note and gave each back. Colleagues saw "drafting reply" and then
nothing. Now the desk says its agent cannot answer, and everyone sees that honestly.

- **A third state, because neither existing one is true.** "Not awake" means no desk runs, and a person
  fixes it by starting one; here the desk runs and only the model is unusable, so starting it again
  changes nothing. "Awake" promises a draft right away. So presence carries `agentUnavailable` beside
  `agentOnline`, read only while an agent holds a stream: when the desk stops, the ordinary "not awake"
  applies.
- **The desk decides, best effort.** `homingbird run` reads what a failed run wrote, its error output
  and what it printed, for each vendor's wording: Claude Code's "usage limit reached|<epoch>" and
  "resets 3pm", Codex's "You've hit your usage limit", a 429 or a rate limit for API keys, and the
  sign-in failures (`agent-availability.ts`). Vendors change their wording, so the dependable rule is
  the count: three failed runs in a row mean the agent cannot answer, with kind `failed`. A usage-limit
  notice printed in place of an answer, which some programs exit cleanly with, is a failure too, so it
  never becomes a draft.
- **While unavailable, the desk leaves notes delivered.** It picks up nothing, so a colleague's note
  waits as `delivered` instead of showing "drafting reply" for a draft that will not come. It tries once
  at the reset time when the agent said one, and otherwise on the next arriving note at most every 15
  minutes; a run that answers clears the state. With nothing waiting at the reset time, the desk takes
  the agent at its word and clears it. A draft request is always tried, since the person asked.
- **What colleagues see is only that, and until when.** The `me.desk.unavailable` body names the kind
  and the time; Dovecote shows colleagues `{ until }` only, and the kind (usage limit, signed out,
  command failing) only to the person themself, in the directory entry they read about themself. Never
  the vendor, the program, or anything the command wrote. The person gets one push when it starts.
- **In memory, beside presence.** The state lives in the hub, like presence and the visible pages, which
  fits the one instance Dovecote supports. It goes when the member's last agent stream closes and on
  `me.desk.available`; a desk whose stream reconnects, after a drop or a server restart, says it again. The routes
  are `member`, called by the desk itself and by no model-facing tool, and the feature
  `deskAvailability`, on by default, turns them off.

## A person joins with an invite link; an allowed domain is optional

Admitting only the email domains in `allowedDomains` shut out every server that is not one company's:
friends on personal Gmail, a few people from different organizations, a company that wants one
contractor in. Now an invite link is the general way in, and allowed domains stay as open admission for
an organization that wants anyone with a company address to sign in.

- **Who gets in.** A verified email is required for everyone. A member the identity provider already
  knows by subject signs in whatever their domain; only a deactivated one is refused, so removing a
  domain no longer locks out the people already in. Anyone else is admitted by an allowed domain (with
  Google's hosted-domain check), by name in `HB_ADMIN_EMAILS`, or, failing those, by a valid invite.
  With no domain set, only invites and `HB_ADMIN_EMAILS` get in, and production starts as before.
- **An invite is spent only when it is needed.** Someone an allowed domain already admits leaves the
  invite unspent. Admitting the person and moving the invite from pending to consumed happen in the
  transaction that signs them in, so a refusal later in sign-in (a deactivated member with that
  address, say) leaves the invite as it was, and two sign-ins cannot both spend it.
- **What an invite is.** Single use, seven days, made in the web client by an administrator, or by any
  member when `whoCanInvite` is `members` (the default is `admins`), so a group of friends can let
  anyone invite. It may be bound to one address, compared with the verified email in lower case. At
  sign-in its maker must still be active and still allowed to invite; deactivating the maker denies
  their pending invites at once, as it does their join codes.
- **No hosted-domain check for an invited person.** The check exists so that an allowed domain cannot
  be claimed by a personal account; an invite names who is welcome instead, and a bound invite names
  the address too. An unbound invite admits whoever opens it first, which is why it lasts a week, not
  longer, and why the guide says to send it to one person.
- **Stored like a token (Rule 5).** The link carries `hbi_` and 32 random bytes; Dovecote keeps the
  SHA-256 hash in `auth_requests` (kind `invite`, `member_id` its maker, the bound address in the
  detail), so no migration step is needed and expired invites go with the same sweep. The link is in
  the one response that creates it. The audit trail records `member.invite_created` (whether it is
  bound, not the address), `member.invite_revoked` and `member.invite_redeemed` (the new member's id)
  by invite id only.
- **The code stays out of addresses the server sees.** The link opens the web client at
  `#/invite/<code>`, a fragment browsers never send; the sign-in page posts the code to `/auth/invite`,
  which checks it, limited to ten tries per address in ten minutes on top of its 256 bits, and starts
  the usual sign-in carrying the invite's id, not its code. Every bad case (unknown, malformed,
  expired, revoked, used, wrong address, a maker who may no longer invite) lands on one page,
  `#/invite-refused`, explained in the person's language. That post carries no session, so the custom
  header that cookie-authenticated writes need does not apply.
- **Who sees which invites.** An administrator lists and revokes every pending invite, a member only
  their own; the routes are `human`, so no agent credential or tool makes or reads one (Rule 3).
- **A switch, on by default.** `invites` turns the routes and `/auth/invite` off with 404 and makes a
  pending invite admit no one; allowed domains and `HB_ADMIN_EMAILS` keep working.

## One activity panel, built from routes that already exist

What waited for a person was spread over five places: their agent's drafts in each conversation, a
channel agent's answers in the channel room, skipped notes in their thread, the desk that cannot answer
under My agent, and debate rooms under Debates. A messenger keeps one list of what needs you, so the
header has a bell that opens it.

- **No new route, so no new rule.** The panel reads what the web client already reads: conversations
  and their notes for drafts and skips, `reviews.list` for answers to review, the person's own
  directory entry for the desk, `debates.list` for rooms, and `inbox.list` to find conversations where
  a skip may sit. A draft is shown with the same card model as in its conversation, so Send still binds
  to the draft as shown and an agent's change still asks the person to read it again (rule 1); an
  answer is shown with the same review card, only to its channel's managers, never to its asker (rule 2).
  Approval stays a click in the web client.
- **Drafts come from loaded conversations.** `drafts.list` would give the text, but a card needs the
  note it replies to and who it goes to, and the read-again check is kept per loaded conversation. So
  the panel loads the conversations whose `draftCount` is above zero when it opens and whenever one
  gets a draft, and counts a conversation not loaded yet by its `draftCount`.
- **Skips are as complete as the conversations loaded.** A released notice comes only with a
  conversation's notes; the panel loads those with unread notes or notes waiting for a reply. A route
  listing every skip waits on the roadmap.
- **Done means gone.** An item leaves once it is sent, discarded, reviewed, answered or the room moved
  on. There is no read state to keep in step across devices.
- **A popover, a page as the fallback.** The bell is a link to `#/activity` that opens a `popover`
  anchored to it where popovers exist; on a narrow screen the same popover is a full-height sheet. Its
  items are drawn only while it is open, so a draft is reported as seen only then.

## Earlier answers come before asking, matched by shared words, from what the asker may read

A lookup in team chat is answered by scrolling back; in Homingbird the same question waited for a
person and their approval even when it had been answered last month. So while a person writes a
question, and before an agent asks a channel, Homingbird shows up to three earlier answers that may
already answer it.

- **What matches.** An earlier answer is a sent reply to a sent question, written by someone other than
  the asker of that question. The question being written is cut into its words (lower case, three
  letters or more, common words left out, at most eight), and a pair matches when half of those words,
  and at least two, appear in its question or its answer. A word in the earlier question counts twice
  a word in the answer: questions asked alike are the better sign. Equal matches put the room the
  question goes to first, then the newer answer, and an earlier question is shown once, with its best
  answer. `rankEarlierAnswers` in `packages/protocol/src/earlier-answers.ts` is the one rule; Dovecote
  and the demo both use it.
- **No model on the server.** Dovecote never calls a model: it runs on SQLite, PostgreSQL and MySQL with
  no outside service, and a server that read every question to a model would hold a copy of every
  conversation in one more place. The matching reuses the `LIKE` search the server already has, over
  the 200 newest candidates. An agent that wants a smarter match reads the results through its own
  model, as quoted data.
- **The privacy rule is search's.** Both notes are sent and the viewer takes part in each one's
  conversation, the rule `visibleNote` and `search.notes` already keep, so a lookup never shows a note
  the asker could not open (rules 2 and 6). A draft, a channel agent's unsent answer and a private
  question someone else asked are never candidates. An open channel the asker has not joined is not
  searched, as search does not search it.
- **The question travels in a body.** `answers.earlier` is a `POST` so the question is never part of a
  URL, which proxies and access logs keep. It is a `member` route so the asker's agent can use it;
  model-facing tools return both notes through `wrapNote` (rules 3 and 4).
- **The agent is shown the answers first.** The MCP `draft_note` to a channel looks earlier answers up
  before drafting; when there are any it drafts nothing and returns them with what to do: tell the
  person the answer, who gave it and when, or call again with `askAnyway`. `find_asked_before` does the
  same lookup alone. A failed lookup or a server without the feature never stops a draft.
- **A deflection is a person's click, counted only.** "This answers it" sends nothing and records who,
  which room the question was going to, and which answer, once per person, room and answer
  (`answers.used`, a `human` route: a model cannot inflate it). Organization insights show the count per
  place and in total, under the same minimum group size as every other place figure; nobody is listed.
  An agent that answers its person from history is not counted.
- **Open questions too.** In a channel's room, the web client also matches the room's questions that
  have no sent answer yet, by the same rule, from the notes it already shows: "Asked 40 minutes ago by
  Ben Okafor, no answer yet", and for a manager whose review the answer waits for, that it does. A
  duplicate question is one more review for a manager; this needs no new route and shows nothing the
  person could not already read.
- **Behind a switch.** The routes are the `earlierAnswers` feature, on by default.

## Code in a note is shown as code; nothing else of Markdown is

Engineering answers are commands, queries, stack traces and diffs, and agents write them in fenced
blocks by default. Shown as running text, the backticks are printed and the alignment is lost, so a
note that a team chat would show as code was harder to read in Homingbird.

- **What is rendered.** A fenced block (a line of three or more backticks, closed by a line of at least
  as many, indented up to three spaces) becomes `<pre><code>` in the monospace token, scrolling sideways
  inside its bubble, with a **Copy** button that copies the block's text. The word after the opening
  fence is kept as `data-language` and nothing more: there is no syntax highlighting. A run of
  backticks closed by a run of the same length on the same line becomes `<code>`. An unclosed fence is
  shown as it was typed, so a stray fence never swallows the rest of a note.
- **Nothing else.** No headings, emphasis, lists, tables, images or HTML. Notes stay text and links by
  design; code is still text, shown as text, and the other Markdown forms read well enough as typed.
- **Built from text nodes.** `codeSpans` in `packages/ui/src/code-spans.ts` cuts the text, and
  `noteText` builds every element with the DOM API; a note is never assigned to `innerHTML`. Links are
  made only outside code, by the same rule as before (`http:` and `https:`, `rel="noopener noreferrer"`).
- **The same everywhere a note is read:** sent notes, draft cards, a channel agent's answer under
  review and debate turns. Model-facing tools are unchanged: they pass the text through `wrapNote`, which
  never interprets it.

## A chance to teach is offered where the agent missed, and the figures open into the drafts behind them

Offers after an edit or a discard were listed only under My agent, Teaching, which a person had no
reason to open at the moment they knew what their agent should have done. Teaching is what raises the
share sent as written, so the offer comes to the place of the miss.

- **In the conversation.** Once the moment to undo a rewritten or discarded draft is over, the chance
  to teach is one line above the composer: "You rewrote your agent's draft. Teach your agent from this
  edit · Not now · Don't ask in this channel", under the same once-a-day limit per place.
- **On a skipped note.** **Teach my agent** sits beside **Ask anyway** in the thread and beside **Reply
  yourself** in the activity panel, and opens the guided form with a title from the note's first line
  and the channel it was asked in.
- **Behind the figures.** `insights.mine` adds `misses`: the drafts the person edited or discarded and
  the notes their agent skipped in the last 30 days, newest first, at most 100, each by note id,
  conversation, place and time only, never what it says. How it is doing lists them under the numbers,
  one folded list per count, each with a way to where it happened and **Teach my agent**. A place's
  "Teach from 2 edited or discarded drafts" on How it is doing leads to the Teaching tab, whose list
  holds those two.
- **Saving stays a person's click** (rule 8): every way in opens the same guided form in the web
  client, filled in, and nothing is saved until the person saves it.
- The add row on the Teaching tab offers Rule or Answer, as the guided form does, and the hint that a
  rule reads as a stored answer also fires on a statement ("X is Y") with no method, condition or wish,
  not only on a number.

## A manager stays in a channel while others are in it, and the client says so before it fails

The server keeps a manager in a room while anyone else is in it, and a channel with people keeps at
least one manager. The room menu offered **Leave channel** to a manager and promised they could join
again, then failed. The client now applies the same rule: a manager who is not alone in the room sees
**Leave channel** disabled, with what to do first (remove themself as a manager, or, as the only one,
add another manager first). Removing someone as a manager is confirmed, and warns when one manager would
be left; when that is the person themself, it says that answers to their own questions will wait for
another manager (rule 1).

## Note bodies link www. and mail addresses too

People write "see www.example.com" and "ask ana@example.com" without a scheme, and every other
messenger they use makes those clickable. Shown as plain text, a colleague had to copy the address by
hand, so the web client now links them as well. The maintainer approved widening the web-client rule.

- **What becomes a link.** `http:` and `https:` addresses as before; an address that starts a word with
  `www.` followed by a name and a dot, opened as `https://` and that address; and a plain mail address
  (name, `@`, a domain with a top-level part of two or more letters), opened as `mailto:` and that
  address. Every link gets `rel="noopener noreferrer"`; web links open in a new tab, mail links do not.
- **Nothing else changes scheme.** A `www.` or mail address that a scheme or a path runs into
  (`javascript:www.x.test`, `mailto:ana@x.test`, `x.test/www.y.test`) stays text, and so do
  `javascript:`, `data:` and every other scheme. A mail address inside a web address belongs to the
  web link. The `href` is always one of `http:`, `https:` or `mailto:`.
- **Trailing punctuation stays outside**, by the same rule as web links: sentence punctuation and a
  closing bracket the address did not open.
- **Built from text nodes.** `textSegments` in `packages/ui/src/linkify.ts` cuts the text and
  `linkedText` builds each link with the DOM API; a note is never assigned to `innerHTML`. Property tests
  check that nothing else becomes a link, that `javascript:` and `data:` never do, and that the text
  around a link is kept as it was.

## Slack is linked by address, not synced

Questions start in Slack, so a team that has to open Homingbird to see them has a second inbox; the
real-work evaluation named this its biggest wall. Homingbird meets Slack where a person addresses it,
and only there: nothing is mirrored, and nothing leaves Homingbird that a person did not approve.

- **One workspace, the organization's own app, a bot token only.** The administrator creates a Slack
  app from the manifest Homingbird shows and gives Dovecote its bot token and signing secret as
  `HB_SLACK_BOT_TOKEN` and `HB_SLACK_SIGNING_SECRET`. Kept in the environment, neither is stored, so
  security rule 5 is unchanged; the cost is that disconnecting takes the operator and a restart. Storing
  them sealed in the database, entered on the admin page, would widen rule 5's exception and waits for
  the maintainer. The first workspace `auth.test` names is pinned; another one's token stops Slack. No
  user token: one reads everything its person can read in Slack and acts as them, the kind of key "A
  cloud desk is woken by a content-free call" already declined to keep. Behind `slack`, off by default.
- **A person links their own Slack user with a single-use code.** **Connect Slack** looks up the
  person's email in Slack and sends that user a direct message with a ten-minute link only this person
  can confirm; a person whose emails differ mentions the app with the word `link` and gets the same
  link in a message only they see. The email finds the user; only the confirmation in the web client,
  signed in as the person, links them. One Slack user per person and back. Deactivating a member
  deletes the link; Slack deactivating the user deletes it too, and never deactivates the member, since
  Slack is not the identity provider. Guests, users of another organization, bots and apps are never
  linked or answered.
- **Review requests carry no content.** A linked person gets a direct message from the app when a
  draft waits for their decision: the same moments, mutes and notification level as a push, a fixed
  sentence and a link to the card. No note text, no names (rule 2). Approval stays in the web client
  (rule 3). This is the roadmap's "review request in the chat tool the team already uses".
- **Events are verified, kept briefly and handled apart.** `POST /slack/events` sits beside the
  contract, like the OAuth endpoints: it is authenticated by Slack's signature (HMAC-SHA256 of
  `v0:<timestamp>:<raw body>`, within five minutes of the clock service), not by a credential. An event
  Homingbird uses is stored by Slack's event id and answered at once, so Slack's three-second limit is
  never at risk and a retry does nothing; a pass handles it and deletes its payload. A channel message
  that is not for Homingbird is dropped before its text is read: never stored, never logged. The app's
  own messages and other apps' are dropped first. An uninstall, a revoked bot token or a token Slack
  refuses stops Slack until a check succeeds.
- **No tool exposed to a model connects, links or posts.** Every Slack route is `human` or `admin`
  (rule 3), and the Slack Web API is called only from the server's own passes and a person's routes.
- **Not in this release** (roadmap): channel links, in and out; a question to one person through a
  mention; direct messages and user tokens; Socket Mode for servers Slack cannot reach; telling the
  administrators by push when Slack stops.

## A saved answer may send itself, word for word, where its person allowed

Approval is the product's bottleneck: a person who saved "Annual plans are refunded pro rata for the
unused full months" still had to click Send each time their agent drafted exactly that. The narrowest
automatic path is the one where nothing new is said: the text is the person's own, written and saved by
them in the web client, and it goes only where they said it may. So security rule 1 gains one sentence:
a saved answer its person switched to send automatically, in the web client, counts as that person's
approval for a draft whose text is exactly that answer, sent where they allowed.

- **The switch belongs to the person, per saved answer.** "Send automatically when it fits" and the
  places it may send itself are set by `principles.autoSend.set`, a `human` route; no model-facing tool,
  MCP, A2A, the command line or the plugin can call it (rules 3 and 8), and `principles.update` cannot
  carry it. A new item starts switched off. Only an answer with its own text can be switched on; a rule,
  or an answer taken only from a source, cannot. Turning an answer into a rule, or deleting it, takes the
  switch and its places away.
- **The places are chosen one by one, at most 20:** direct messages and the rooms of open channels the
  person is in. A private channel, a group message, a private question and an archived room have no
  door, both when the switch is saved and again when a draft would be sent.
- **The server sends a draft without a click only when all of these hold**, checked on `drafts.create`
  and on `drafts.update`, in the same transaction as the send: the organization has `autoSend` on (off
  by default; administrators switch it in Settings) and `teaching` on; the draft comes from the person's
  own agent credential, not from the person, a channel's agent or a debate room; its basis says it
  applied that saved answer by title, the same "Principles applied:" match every draft gets; the answer
  is enabled and switched on; the draft's text equals the answer's text exactly, ignoring only the
  whitespace around either (`isSavedAnswerText` in `protocol`), so one character more, less or changed,
  case included, keeps it on the card; the draft's conversation is one of the answer's places and still
  allowed; and the person may still message there. The send goes through the same `deliverDraft` as a
  click, so the `UPDATE` matches the text and room just checked. Anything else is an ordinary draft on
  the approval card, as before.
- **What is never sent automatically:** a draft that adds, removes or changes anything; one that did not
  say it applied the answer; one going anywhere the person did not tick; a channel agent's answer; a
  debate room's result; a note the person writes themself; anything while the feature is off. Matching by
  meaning, by model or by similarity was left out on purpose: the roadmap's route-based automatic
  sending, which composes, still waits for the pilot.
- **The note says how it was sent.** It records the person as `approved_by` and the answer that sent it
  as `auto_principle_id`; on the wire it carries `autoSent: true` and no `approvedBy`, which keeps
  meaning "the person who approved a channel's agent's note". Recipients read "Sent automatically from
  June's saved answer"; the author reads "from your saved answer". The answer's title and text stay
  private, as every principle does. Agent integrations say the note was sent and that only the person
  can recall it.
- **Recall: five minutes, the author only, a `human` route (`notes.recall`).** Recalling moves the note
  from `sent` to a new status, `withdrawn`; its receipts go, so recipients stop seeing it on every
  surface (lookup, thread, inbox, search, stream), because every note query already shows a recipient
  only `status = 'sent'`. Each participant's stream gets `note.withdrawn` with the ids only; the author
  keeps the note, marked as recalled. A reply it was settles back to waiting unless another reply was
  sent. The window runs from `sentAt`. A note the person sent with a click cannot be recalled: it was
  read before it went. A push notification that already reached a phone cannot be taken back, and a
  recipient may have read the note in the meantime; recall hides, it does not unsay.
- **Audited, never with text:** `principle.auto_send_changed` (on or off, and how many places) and
  `note.auto_sent` (the conversation and the answer's id, with the agent credential that drafted it),
  and `note.recalled`.
- **Counted apart.** An automatically sent note is not a decided draft: it is left out of drafts
  written, sent as written, quick approvals and the typical decision time, for the person, for teams
  and for the organization, and counted on its own line ("Sent by your saved answers", and for
  administrators "Sent by saved answers", hidden below the minimum group like debate results). A saved
  answer's own counts show how often it sent itself. The lines appear only while the feature is on.
- **Compatibility.** `withdrawn` is a new note status: an older client reads it as unknown, which
  means not sent. `note.withdrawn` is a new event, which an older client skips. `autoSend` on a
  principle, `autoSent` on a note and the new figures are optional on the wire. The schema step adds
  `principles.auto_send`, `principle_auto_send_places`, `notes.auto_principle_id` and
  `notes.withdrawn_at`.

## Proposed: a note asks the people it names, and only their agents draft

**Proposed, not built; the maintainer reads this before any of it is.** Today one note to a group of
five wakes four desks and can cost four drafts and four approvals, because being able to read a note
and being asked to answer it are the same thing outside a channel. The proposal separates them: a note
is read by everyone in its room, as now, and **asks** only the people its author named; only an asked
person's agent is handed the note to draft from. Group work beyond leaving and hiding (a larger group,
joining in place, mentioning a team) waits for this.

- **Reading and being asked are two things, and only the second is new.** Who reads a note stays the
  room's participants (rule 6), and "Send delivers it to Ana, Kai and Ben." stays the approval's promise.
  Asking is a subset of those readers, chosen per note. Nothing here adds or removes a reader.
- **Who is asked, by kind of room.**

  | Room | The note names nobody | The note names people |
  | --- | --- | --- |
  | Direct message | The other person, as today | Not offered: there is one other person |
  | Group message | A reply asks the author of the note it answers. A note that answers nothing asks nobody: it is delivered to read. | Exactly those people |
  | Channel room | As today: a question asks the channel's helpers, a reply asks the asker | Exactly those people, in place of the helpers |
  | Private question to a channel's agent | As today | Not offered |

  A named person must be in the room when the note is sent. In a channel a named member is asked
  whether or not they answer questions there: "Answer questions here" is about questions put to the
  room, and a name puts the question to a person, which a direct message could do anyway. A channel's
  agent can be named in its own room, and then it alone drafts; it can be named nowhere else (rule 6).
- **Naming is data on the note, never read out of its text.** A draft carries `asks`, a list of member
  ids, on `drafts.create` and `drafts.update`, which stay `member` routes; a sent note returns it to
  everyone who can read the note. In the web client, typing `@` in the composer opens the people
  picker over the room's people; choosing one adds them to the list and writes their name into the
  text as plain words. The server never looks for names in a body: display names are not unique, a
  quoted note can contain anyone's name, and the card a person approves must show exactly who is
  asked, which only a stored list can promise.
- **A note asks at most three people (`ASKED_MAX`).** A question for more people than that is a
  channel's question, where one answer settles it for the other helpers. The number is a first value;
  the measurement below sets it. There is no "everyone" and no "here": either would be the
  multiplication under another name.
- **Whose agent drafts: the asked person's, and nobody else's.** A receipt records whether its member
  was asked (`receipts.asked`, a nullable column in a new migration step; a stored receipt without it
  reads as asked, which is what it meant). Every reader of a direct or group note keeps a receipt, so
  unread counts and "Read by 2 of 3" stay as they are. For an agent credential, `inbox.list` returns
  only asked receipts, `notes.pickup` refuses a note its person was not asked (409, with a sentence),
  and the stream and the cloud desk wake only for an asked note. So the other people's agents do not
  skip the note: they are never handed it. This is decided by the server from stored data, never by a
  model reading the note and judging whether it concerns its person.
- **A person can still ask their own agent anywhere they can read.** **Ask my agent to draft a reply**
  (a draft request, a `human` route) works on any note, asked or not. The limit is on what arrives
  uninvited, never on what a person requests.
- **The approval card says who is asked, and Send binds to it.** Under "Send delivers it to Ana, Kai
  and Ben." the card reads "Kai is asked to answer." or "No one is asked; everyone in the group can
  read it." as whole sentences per language. `drafts.send`'s `expected` gains the asked list beside
  the body and the conversation, compared at the read and again in the `UPDATE`, so an agent that
  changes whom its draft asks after the person read the card is refused with "This draft changed; read
  it again." This adds a check to rule 1's send; it removes none.
- **An agent may propose whom its draft asks; a person approves it like the rest of the draft.**
  Setting `asks` on its own draft is the same act as re-addressing its own draft to another channel:
  nothing goes anywhere until the person approves, and the card shows it. A draft that names anyone
  is never sent automatically: a saved answer that sends itself is a reply, and asks only the author
  of the note it answers. A channel's agent's draft names nobody; it is a reply to its asker.
- **Naming adds no reader.** A name of someone outside the room is plain text, in every kind of room,
  and the picker offers only the room's people. Bringing a person in stays its own act: joining an
  open channel, a manager's add in a private one, a new group. Otherwise a note approved for three
  readers could gain a fourth by one word in its text.
- **How the named person is told.** Their push title says they are asked ("Ana asks you in a group
  message"); the conversation row and the activity panel count the note under what waits for them,
  apart from plain unread; the tab title counts it with approvals. A mute and the notification level
  still decide every push (`wantsPushAbout`): being named does not break through a mute, because the
  mute is the person's and no colleague's word overrides it. A fourth level, "only when I am asked",
  becomes possible and is left for later.
- **What the sender sees.** Under their own note: "Asked Kai" with the usual "Read by 2 of 3", and
  "1/2 replied" counting the asked only. A note that asks nobody shows no "No answer yet", since none
  was asked for. "Drafting reply" appears only for an asked person, so it keeps meaning that a reply
  is being written.
- **What a model sees.** The asked person's desk is handed the note as today, inside `wrapNote`
  (rule 4). The wrapper's opening tag gains an `asks` attribute with the asked people's names, escaped
  by `escapeAttribute` as `from` is, so an agent reading a thread can tell whose answer each note
  wanted. Names are text people chose, so they appear only there, inside the quote, never in the
  instructions around it. The one instruction added outside the quote is fixed text with nothing a
  colleague wrote: "Your person was asked to answer the note below."
- **Counting the drafts.** With every person's desk running, one note in a group of n people can
  produce today n − 1 drafts and n − 1 approvals. Proposed: as many as were named, at most three; one
  for a reply; none for a note that asks nobody. A channel question that names one member produces one
  draft where it produced one per helper.
- **Behind a switch.** The feature key is `asking`, on by default once released. While it is off,
  `asks` is refused on a draft, every reader of a direct or group note is asked, and the web client
  hides the picker and the asked line: today's behaviour. `Note.asks` is optional on the wire, so an
  older client reads a note without it. No new route: the two draft routes and `drafts.send` gain a
  field, and `drafts.send` is called only by the bundled web client, so it changes at once.
- **Rules touched, all by adding.** Rule 1: `expected` gains the asked list. Rule 2: whom a draft asks
  is part of the draft, shown only where the draft itself is: to its author, to a channel agent's
  reviewers, and on an early preview its person allowed, which may say whom the draft would ask and
  asks nobody. A draft creates no receipt, so no one is asked, notified or handed anything before it
  is sent. Proposed wording, added to rule 2: "Whom a draft asks is part of the draft: it is shown
  only where the draft is, and it asks no one before it is sent." Rule 6: proposed wording, added:
  "Naming a person in a note asks them; it never shows a note or a conversation to someone who is not in it." Rule 3 is unchanged: no tool
  exposed to a model can send, so none can make a note ask anyone. Rule 4: one attribute more inside
  the only wrapper. Rule 5 is not touched. `security-rules.test.ts` gains cases and loses none: a
  person who was not asked gets no inbox item for their agent credential and cannot pick the note up;
  a draft's asked list is absent from every route a named person can call until it is sent, an
  allowed preview aside, and from every route an agent credential of theirs can call; naming a
  member outside the room is refused; a send whose asked list differs from `expected` is refused; an
  automatically sent note names nobody; `wrapNote` escapes a name that tries to close the tag.

**Alternatives rejected.**

- **A mention as a notification level only, as in Slack.** It tells people apart and leaves every
  agent drafting. The cost here is approvals, and a louder notification does not lower it.
- **Reading `@name` out of the note's text on the server.** Names collide and change, a quoted note
  carries other people's names, and the approval card would show a guess. A stored list can be bound
  into `expected`; a parse cannot.
- **Leaving it to each agent to skip what is not for its person.** This is today's behaviour. It runs
  a model per person per note, shows "drafting reply" for drafts that never come, and lets a model's
  reading of a colleague's text decide who answers. It may already keep drafts low; that is the
  measurement below, and the reason this is a proposal.
- **One draft per group note, written by the first desk to pick it up.** The answer would come from
  whoever's computer was fastest, not from whoever knows.
- **The server, or a routing agent, choosing who should answer.** Dovecote calls no model, and a
  router that forwards questions needs an approval at every hop (roadmap, "Where to ask").
- **Everyone is asked unless they opted out of the room.** It moves the cost of one person's vague
  note onto every reader's settings. "My agent does not draft here" stays on the roadmap as each
  person's own switch, beside this, never in place of it.
- **A mention that adds the named person to the room, as in Google Chat.** It changes who reads after
  the approval that promised who would.
- **`@everyone`, or naming a whole group message.** One word would bring back n − 1 drafts.
- **Asking as a way to narrow who reads.** A note only some of the room may read is another
  conversation; rule 6 is kept by participation, and a second visibility rule inside a room would
  have to be added to every note query.
- **"Any one of these people" as a second kind of ask.** A channel already does that with its helpers,
  where one sent reply takes the question out of the others' inboxes. In a group each named person is
  asked for their own answer, which is why the list is short.

**Would weaken rule 1, 4 or 5. Not adopted; each needs the maintainer's explicit approval and stays a
proposal until then.**

- *Rule 1.* Letting a note that sends itself (a saved answer, or any later automatic route) carry an
  asked list its agent chose. The person would have approved the words and the place, never who is put
  to work by them. This design keeps automatic sends to a reply that asks only its asker.
- *Rule 1.* Leaving the asked list out of `expected` because "it is not what is sent". It is to whom,
  and an agent could change it between the read and the tap.
- *Rule 4.* Telling a model whom a note asks, or what it asks, in the instructions outside `wrapNote`
  ("Ana asks you to …"). Names and requests are a colleague's text and stay inside the quote.
- *Rule 5.* Nothing in this design stores, shows or logs a credential, so no variant is proposed.

**Open, for the maintainer, and to measure first.**

- Not measured: how many drafts one group note produces today, with agents connected for three people
  on a real Dovecote, and how many of the picked-up notes end in a skip. If skips already hold drafts
  near one per note, the default for a group note that names nobody could stay "everyone is asked"
  for groups of three, with naming as the way to narrow. The proposal's default is the stricter one.
- `ASKED_MAX`: three, or the size of the largest group message.
- Whether a named channel member with answering off is asked (proposed: yes).
- Mentioning a team resolves, when the note is sent, to the team's members who are in the room, counts
  against `ASKED_MAX`, and is refused above it. It stays on the roadmap until this is built.

## Proposed: a mark is a person's click, and the same marks settle a channel's decisions

**Proposed, not built.** A person answers a note with one of three marks, **seen**, **agree** or
**disagree**, in place of a note that says only that. It is one mechanism with the roadmap's decision
rules ([roadmap](roadmap.md#groups-and-channel-agents), item 5): a mark is the acknowledgement, and a
channel's rule, where one exists, counts the agree and disagree marks of its group. No tool exposed to
a model can cast one.

- **Three marks, a fixed set, no text.** No emoji picker, no custom marks, no reason shown to others.
  A mark is a member, a note and one of three words, so it has nothing that can carry an instruction
  and nothing to translate but its label. "Seen" is deliberate, and differs from `read`, which is
  recorded when the person opens the note: seen says "I have this, and I am not going to answer".
- **Who may mark, and who sees it.** A person who can read a sent note, in the web client, one mark
  per person and note, changed or removed by the same person. Everyone who can read the note sees who
  marked it and how, with characters and names; a mark is never anonymous and never counted without
  its people. A draft cannot be marked, an early preview of one included (rule 2), and a mark shows a
  note to no one new (rule 6).
- **A mark answers.** For an asked person, a mark settles their receipt as a reply does: the sender
  reads "1 replied · 1 seen" in place of "1/2 replied", the note leaves "waiting for you", and their
  desk is not handed a note they already marked. A draft their agent had written stays on its card
  until they send or discard it; the mark decides nothing about a draft.
- **A mark sends no push and wakes no desk.** That is its use: an acknowledgement that costs its
  reader nothing. It arrives on the stream as `note.marked` with ids and the mark, and the page shows
  it.
- **Routes.** `notes.mark.set` and `notes.mark.clear`, both `human`, behind the feature key `marks`,
  audited as `note.marked` and `note.mark_cleared` with the note's id and the mark, which is an enum
  and not content. The mark is a tolerant enum: one a client does not know reads as `unknown`, which
  means no mark and counts toward no rule.
- **With a decision rule.** A channel's rule names a group and a number. On a note a member put to the
  channel as a proposal, the agree and disagree marks of that group's members are counted; "seen"
  never is. When the number is met the note is marked settled and the room is told. Without a rule,
  marks only acknowledge. One table and one pair of routes serve both, so there is no second way to
  agree.
- **Models.** In the first version no model-facing tool returns marks at all; an agent needs none to
  draft. If a later tool shows them, they go inside the same `wrapNote` quote as the note they are
  on, since they carry people's names (rule 4).
- **Proposed wording for rule 3, added to it.** The strict form, recommended for the first version:

  > No tool exposed to a model can cast, change or remove a mark on a note.

  The form that allows proposals only, to replace it when an agent's proposed mark is built:

  > No tool exposed to a model can cast, change or remove a mark on a note. A tool may propose its
  > person's mark with a reason; the proposal is shown to that person alone, and counts, and is shown
  > to anyone else, only after they confirm it in the web client.

  Neither weakens rule 1, 4 or 5: both add to what a model cannot do. The reason is rule 3's own:
  were a model able to mark, agents could acknowledge, and settle, what no person saw.
  `security-rules.test.ts` gains: no model-facing tool names the mark routes; an agent credential is
  refused on both; a mark on a note the caller cannot read answers as for a note that does not exist;
  a proposed mark is absent from every route another member can call.
- **A proposed mark is as invisible as a draft.** When proposals are built, a proposal is kept like a
  draft: its person sees it on the note with its reason, nobody else does, and it counts toward no
  rule until confirmed. A confirmation made within the quick-approval time counts as a quick approval
  in the person's own figures.

**Alternatives rejected.**

- **Free emoji reactions.** They need a picker the bundle does not have, mean different things to
  different people, and cannot be counted by a rule.
- **Marks and decision rules as two mechanisms.** People would agree twice, and the two would
  disagree.
- **A reply written and sent by the agent for "thanks" and "agreed".** That is a note sent without a
  person, which rule 1 forbids.
- **"Seen" set automatically when the note is opened.** `read` already says that. A mark is a
  decision not to answer, and only its person can make it.

**Would weaken rule 1. Not adopted; needs the maintainer's explicit approval.**

- An agent casting its person's mark without their confirmation, in any scope. Where a decision rule
  decides whether a draft is sent, a delegated mark is an approval no person gave. The roadmap already
  names what it would need: a delegation the person scopes, an organization setting that is off by
  default, an audit entry per delegated decision, and results that show delegated decisions apart.
- A decision rule that sends a channel agent's draft on marks alone, without one manager's Send. A
  rule may ask for more approvers than one; it never replaces the send.

## A person may let chosen colleagues see their agent's drafts early

Approval is the slowest step between colleagues: a question can sit for an hour while its answer is
already written and waits for one person's click. So a person may let chosen people, and the rooms of
chosen channels, see what their own agent drafted before they check it. Rule 2 says so, and every note
query now filters by `status = 'sent' OR author_id = viewer`, or an allowed preview for the viewer.

- **Off twice by default.** The `draftPreviews` feature is off until an administrator turns it on, and
  each person's allowance is empty until they choose someone under **My agent → Early previews**. Only
  the person sets it, through `human` routes (`me.draftPreviews.get`, `me.draftPreviews.set`); no
  model-facing tool can set or read it (rule 3). Changing it is audited as
  `draft_preview.allowed_changed` with how many people and channels, never who wrote what.
- **Only the person's own agent's words.** A draft previews when an agent credential of the person
  wrote it, it is still a draft, and it waits in a direct or group conversation with an allowed person
  or in an allowed channel's room. A person's own hand-written draft, a debate room's result, a draft
  in a private question and a channel's agent's answer never preview: a channel's agent's answers stay
  with its channel's reviewers (rules 2 and 6). An allowed channel is kept by its room, so renaming the
  channel keeps the allowance.
- **Unconfirmed, and nothing to act on.** The recipient sees a dashed, muted card, "Unconfirmed draft
  from Kai's agent. Kai has not checked it yet." It has no Reply, no quote and no copy; it is not in
  search, not counted as unread and not notified. Once sent, the same conversation shows the sent note
  with a line that says it was checked, or changed before sending. Once discarded, the card keeps its
  place as "Kai withdrew this draft", and its words are gone from every response.
- **Previews never reach an agent.** They are read only through `previews.list`, a `human` route, so
  an agent credential gets 403. The event that says previews changed, `preview.changed`, carries a
  conversation id and no text, is not stored, and is dropped from any stream an agent credential holds;
  it wakes no desk and pushes nothing. Inbox, search, lookup by id, `conversations.notes`, unread counts
  and every `member` route answer exactly as before, so MCP, the CLI, A2A and the plugin cannot see a
  preview, and `wrapNote` still wraps only sent notes (rule 4): an agent never acts on an unconfirmed
  draft.
- **A conversation does not appear because of a preview.** A direct or group conversation is still
  shown only once a note in it is sent, so a preview shows only where the viewer already talks with the
  author. Showing a new conversation that holds only a preview waits on the roadmap.

## Each place climbs four steps to "answers like you"; the route map is gone

The route map drew each place as a line around the person, its width a logarithm of principles plus
drafts sent as written with them. Widths in real use differed by under a pixel, nothing showed what a
finished place looked like, the count ignored edits and discards, and none of its four marks was
explained on the drawing. How it is doing answered the same question better, one tab away. So the tab
is gone, and its question is answered where the figures are.

- **Four steps, the last one the existing verdict.** Only drafts; you taught principles; principles hold
  (a draft that applied one was sent as written); answers like you ★, the place's 30-day verdict
  `usually_as_written` (at least 10 decided, at least 7 in 10 sent as written). The finished state is
  printed on every row, not invented for the picture.
- **The step reflects now; the sentence frames a drop.** The last step follows 30 days and can be lost.
  Making it sticky would show "answers like you" where it no longer does. Instead, when the 30 days
  before had the verdict and now do not, the sentence says some recent drafts needed edits and to teach
  what changed: an edit is a chance to teach, never a step back.
- **A principle for any channel counts in every place.** It has `place: null`, as do direct messages, and
  the route map matched `principle.place === place`, so it counted only in direct messages. `routes`
  now counts every principle that applies in a place, and "held up" as distinct drafts there that
  applied one and went out as written, so one anywhere-principle is not credited with drafts from
  other places.
- **"Chances to teach" means the open offers, everywhere.** A place's chances are the offers Teaching
  lists that came from there, so the button and the list agree; the drafts behind the figures no
  longer call themselves chances.
- **A tooltip per step, and the same words in the open.** Each step is focusable and describes itself
  on hover and focus; on a narrow row only the current step is named, and **What the steps mean**
  lists all four for touch screens.
- **A retired switch is accepted for one release.** `routeMap` left `FEATURES`, so clients see it off.
  `HB_FEATURES` would then have refused to start a server set up with it, so `RETIRED_FEATURES` names
  it: accepted and ignored in this release, refused in the next, as compatibility.md asks for a removed
  capability. Debate credits stay under Teaching, Milestones, where they already were.
