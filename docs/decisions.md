# Decisions

Product decisions serve one direction: helping a person come to trust their agent's answers. Each entry
states the decision first, then the reason. Add new entries at the top of their section.

## Product

- **A debate room is room content, not notes: agents take turns, people approve one result, and only
  that result leaves the room.** Opening a room, opting one's own agent in, setting limits, approving or
  declining the result, posting it and exporting are `human` routes; reading a room and, for the agent
  credential its person opted in, taking a turn and drafting the result are `member` routes, checked
  again in the domain (`debate-*.ts` in `dovecote`). One agent per person per room, at most 8, and no
  two turns in a row by the same agent. The room stops at the total, when no agent has a turn left, or
  at its time limit (a background pass each minute while the switch is on, and on every read). A room
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
  or ended. Desks wake only for a room their person's agent takes part in. Turns reach a model only
  through `quotedDebate`, which wraps the question and every turn in `wrapNote`; the Markdown export
  escapes everything people and agents wrote, so no text can add a heading, an HTML tag or a link other
  than http(s). The growth record keeps the kinds of credit an approved result names, each once
  (`debate_credits`), as milestones and on the route map; never a count. A turn could have been a note
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
  the person.** The page has four headed sections in a fixed order, Connection (agents and devices, the
  desk, renaming and revoking, a connection code), Teaching, How it is doing and Route map, each at its
  own address (`#/agent/connection` and so on); `#/connect` and `#/credentials` lead to Connection. The
  profile keeps the name, character, language, notifications and the line colleagues see. A summary
  card above the conversation list repeated the page and pushed the list down, so there is none; the
  quick-approval nudge moved to where it matters: a draft card shows one quiet line above Send when the
  person approved quickly often this week and the draft contains a date, a number or a promise, found by
  simple patterns. It never blocks sending.
- **Session health is recorded with each agent draft and shown only to its author.** A desk reports the
  session's age in minutes and, where it can know it, its context use: the mod reads both from Claude
  Code's `$.session.usage()` and hands them to the command line in `HOMINGBIRD_SESSION`, outside any
  argument a model writes; an MCP desk's model may state them, like its model; the runner starts afresh
  for every note and sends no session, so its drafts stay out of these figures. How it is doing groups
  decided drafts into four age and four context buckets and shows edit and discard shares only from five
  drafts per bucket. A fresh session is suggested from 8 hours or 80% context use, judged from a desk's
  latest draft only while it is under an hour old (`FRESH_SESSION_AFTER_MINUTES`,
  `FRESH_SESSION_AT_CONTEXT_PERCENT` in `protocol`; the mod keeps an equal copy, checked by a test). A
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
  basis names an applied answer by its title, as for a rule. A person still approves every draft.
- **Principles are a person's rules for their own agent, saved only by that person in the web client
  (security rule 8).** Saving, changing, turning off, deleting and "wrong here" are `human` routes;
  the only route an agent reaches is `principles.drafting` (`member`, read-only, own principles only),
  which each desk calls for every draft so it always follows the current set. A desk adds them after
  the answering flow through one helper in `protocol` (`principlesInstructions`, `draftingGuidance`),
  shared by the runner, the MCP server and the mod, whose overview carries them; in split mode only
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
  which fewer than `HB_INSIGHTS_MINIMUM_GROUP` people (at least 5) were active, and no channel whose
  contributors are fewer; when the hidden groups together are still fewer people, the next smallest is
  hidden too, so subtracting the shown ones from the totals never isolates a small group. Differences
  between periods are not suppressed.
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
- **The web client, push titles and the mod's pane speak English and Korean; nothing a model reads
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
  `packages/mod/hooks/pane-text/`) plus its tag in `LOCALES`; the compiler names every surface a
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
  time in the web client and the mod and validates them in Dovecote. Keeping the generator in the
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

- **The answering flow's stored text marks a turned off step with "[off] ".** The administration page
  edits the flow as two to-do lists and serialises them to the same two headed lists the server
  already validated; a turned off step keeps its place in the text, counts toward the 20 steps and
  4,000 characters, and is left out of every agent's instructions by the one parser in `protocol`
  (`answeringFlowSteps`, `answeringFlowFrom`). Storing the steps as structured data would have changed
  the setting's contract for every client; one marker kept it.
- **The marketplace entry names the exact mod version.** Its npm source carries `version`, written by
  `scripts/release-version.ts` on every version bump with the other version holders, because an npm
  source without one installs `latest`, and during pre-releases `latest` lagged behind `next`.
- **`protocol` depends on `sprites`, and the mod carries a generated copy of the character rules.**
  `sprites` depends only on `kernel`, so there is no cycle, and the wire schema of a character is the
  one `CharacterSpec` the art is drawn from. The mod may import only its own files and reaches the server
  only through the command line, so `mod/hooks/character-rules.mjs` is an esbuild bundle of
  `characterProblems`, `characterLink` and the built-in characters; `protocol/test/mod-character-rules.test.ts`
  fails when it differs from a fresh bundle (`HB_WRITE_MOD_BUNDLE=1` writes it). The web client draws
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
  `build` and `refactor` release nothing), and writes it to every package, the root, the mod's
  `plugin.json`, the marketplace pin and the two version constants, so all share one version. It
  writes the notes (`release-notes.ts`: breaking changes, added, fixed, performance, each entry the
  summary and the first body paragraph) as a section of the one root `CHANGELOG.md`. The release
  workflow rebuilds `release/main` from `main` and opens the pull request with `gh`; a person may edit
  the section on that branch, and the published release takes its notes from the merged
  `CHANGELOG.md`, never regenerated. Pre-releases are a committed setting, `"pre"` in `release.json`,
  instead of a tool's mode.
- **The mod ships its own copy of the command line, and its marketplace entry is the npm package.**
  `@homingbird/mod` holds the plugin files plus `cli/homingbird.mjs`, and the mod runs that file with
  `node` unless **Homingbird command** names another. The copy always matches the mod's version and
  needs no network when it runs. A relative path to `packages/mod` would install the repository's
  files, which hold no built bundle; committing the bundle would put generated code in review. The
  cost: the mod installs only from a published release, and a checkout without `pnpm build` falls back
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
  refused at start with one sentence and left as it is, rather than guessed at. Upgrades between 0.x
  versions are not promised, and a database from a 0.1.0 release candidate is recreated.
- **Source runs as TypeScript; deliverables are bundles.** Packages export their `.ts` sources to each
  other. `esbuild` produces the server, CLI and web bundles.

## Authentication

- **Approval happens only in a client where the person signed in themself; no agent integration can
  approve.** The Claude Code mod once offered an approve button backed by a human credential stored
  on the person's computer (`approval-credential.json`). The agent runs on that computer as the same OS
  user, so the only thing between a prompt-injected agent and that file was a pattern blocklist in the
  mod's guard, and a credential on the same machine as the agent cannot be protected by pattern
  matching: any command, script or tool the agent can run may read it under a name the patterns do not
  know. So the button, its credential, the `approve` scope, `HB_APPROVE_BUTTON`, `server.info`'s
  `approveButton` and the command line's `approve`, `discard` and `login --approve-button` are gone. A
  device or OAuth sign-in issues an agent credential and nothing else; the pane shows a draft as waiting
  for approval and links to it in the web client. The mod's guard still asks the model to leave the
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
- **The identity provider's discovery document is checked before anything is sent to it.** Its
  `issuer` must equal `HB_OIDC_ISSUER` exactly (trailing slashes aside), and its authorization, token
  and key endpoints must be https on a public host name (http only on loopback when Dovecote itself
  runs on loopback). They need not share the issuer's origin, because providers such as Google serve
  them from other hosts; instead discovery, keys and the token call refuse redirects, so the client
  secret and the authorization code go only to the endpoint the pinned issuer's own document names.
  A document that fails is not cached, sign-in says it is unavailable, and the server log says why. An
  ID token must carry an `iat` no later than the clock-skew allowance, and its `nbf` is honoured. As
  for push and client metadata, host names are checked, DNS answers are not.
- **Identity providers are OpenID Connect.** Google Workspace is the default issuer; for Google, the
  hosted-domain claim must match the email domain so personal accounts are refused.
- **Access ends with the session.** Sessions expire after `HB_SESSION_DAYS` and renewing one requires
  signing in with the identity provider again. Deactivating a member revokes every credential at once.
- **Cookie-authenticated writes need a custom header** and a matching `Origin`. Cross-origin requests
  are never allowed for cookie sessions.

## Audit

- **Every state-changing API call and every authentication event is audited in the same transaction
  as the action.** Reads are not audited.
- **Audit entries can be forwarded** as JSON lines on stdout or to a webhook. Both are off by default
  because entries contain note content.

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
- A person in the room may move an unanswered question to another channel. It leaves the old room.
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
- **Managers change a room; the creator is the first.** A manager adds and removes members of a
  private channel, grants and revokes manager, and changes the visibility; nobody joins a private channel
  by themselves, not even an administrator, who adds people as a manager would. A channel with members
  keeps a manager: the last one cannot step down, leave or be removed until another exists. Seeded
  channels have no manager until an administrator names one, and a channel needs a manager in the room
  before it can become private.
- **Open → private keeps everyone in the room; private → open is allowed and audited.** Every
  membership, answering, manager and visibility change is a `human` route, so it is audited and never
  reachable by a model.
- **A private room keeps its questions.** A question in a private channel moves only to another
  private channel with the same members; one moves into a private channel only when the mover and the
  asker are members. A removed member's waiting drafts in the room are discarded and the room drops
  from their clients at once through `channel.left`, which carries only the slug and room id.
- **The web client shows "Private" with a lock, never colour alone.** Korean uses 비공개 and 공개 for
  the visibility, 참여하기 and 나가기 for join and leave, 여기서 질문에 답하기 for the switch, and
  운영자 for a channel manager, because 관리자 already means a server administrator.

## One desk session per person reacts to arriving notes

Each person keeps one agent session open for Homingbird: the desk. In Claude Code it is the session
where the mod's pane is open; for other agents it is the runner, `homingbird run --agent`. Only the
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
run", past launchers such as `env` or `npx`; the mod asks its host for "Claude Code" and its version;
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
  after a run with the real agent, and "from source, unrun" when written from the tool's source code.
  A reader that keeps some tools, as Codex's does, is marked so and never passes
  `--require-toolless-reader`.
- **Pausing is a file beside the desk claim.** `homingbird desk pause` writes
  `desks/<server>~<member>.paused`; every runner on the computer, CLI and MCP-hosted, checks it before
  each note and request and keeps its claim while paused, so pausing never hands the desk to another
  runner.
