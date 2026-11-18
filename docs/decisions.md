# Decisions

Each entry states the decision first, then the reason. Add new entries at the top of their section.

## Product

- **Presence is shown in words wherever there is room, and by shape as well as colour where there is
  not.** Directory rows and the thread header read "Person online · Agent offline"; the narrow
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
  topic → 주제; Homingbird, Dovecote and Pip stay in Latin letters. One language is one file per
  surface (`packages/pwa/src/languages/`, `packages/dovecote/src/push/titles/`,
  `packages/mod/hooks/pane-text/`) plus its tag in `LOCALES`; the compiler names every surface a
  new tag still lacks.
- **A new or changed member appears in open directories at once.** Dovecote broadcasts an ephemeral
  `directory.changed` event, also when someone starts or stops helping with a topic and when an
  administrator renames, merges or removes one; clients refetch the directory, the topics and the
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
- **Changesets decides versions, through a "Version Packages" pull request.** `@changesets/cli`, a
  development dependency, replaces hand-made tags and `scripts/set-version.ts` as the way a release
  starts. Each change brings a changeset; merging the pull request the release workflow keeps open
  releases. Every package is in one `fixed` group, so all share one version, and private ones are
  versioned but never published. `scripts/release-version.ts` runs after `changeset version` to set
  the version where Changesets does not (the root `package.json`, the mod's `plugin.json`, the two
  version constants) and to write the one root `CHANGELOG.md` from the changesets, since Changesets
  only writes per-package files; it uses no GitHub-token changelog plugin. The release workflow
  versions on `changeset-release/main` and opens the pull request with `gh` itself, because
  `changesets/action` reads a `CHANGELOG.md` in every released package, private ones included, to
  write its pull-request body. Pre-releases use Changesets' pre mode. Commit types do not decide
  versions.
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
- **Startup is one task, `prepareDatabase`: migrate, then seed topics.** Every embedded server gets
  the topics in `HB_TOPICS` the same way `main.ts` does.
- **The 0.1.0 schema is one baseline, version 1, and Dovecote touches no database it did not make.**
  A new database gets every table in its 0.1.0 shape at once; the first later change will be step 2.
  A database that records versions this build does not know, or holds its tables with no version, is
  refused at start with one sentence and left as it is, rather than guessed at. Upgrades between 0.x
  versions are not promised, and a database from a 0.1.0 release candidate is recreated.
- **Source runs as TypeScript; deliverables are bundles.** Packages export their `.ts` sources to each
  other. `esbuild` produces the server, CLI and web bundles.

## Authentication

- **Turning the approve button off also stops the approve buttons issued while it was on.** An
  approve-button credential is marked (`credentials.purpose = 'approve_button'`), and while
  `HB_APPROVE_BUTTON` is off Dovecote refuses it on every `human` and `admin` route with "The
  organization has turned the approve button off." and audits the refusal. Revoking every such credential instead would make
  switching the setting back on a chore for everyone; refusing them keeps the decision with the
  setting. `homingbird login --approve-button` says that the organization has turned the button off,
  and `homingbird status --json` reports `approveButton` (the setting) next to `hasApproveButton`
  (this device) and the member's `locale`, which the mod uses for its pane.
- **The approve button is decided once per deployment, and is off by default.** `HB_APPROVE_BUTTON=on`
  lets the device flow issue an approval credential to the Claude Code mod; off, a request for the
  `approve` scope is granted as an agent credential only and `device.decide` ignores
  `allowApproval`. `server.info` says which, so the mod signs in accordingly and the device page shows
  the checkbox only when it is on. An approval credential on the same computer as the agent is
  protected only by the mod's pattern guard, while approval in the web client is enforced by the
  server, so the organization takes that risk knowingly rather than each person being asked.
- **The runner never runs next to an approve-button credential.** `homingbird run` starts an agent
  command as the person's own OS user, so that command can read any file the person can, and the
  model behind it may follow a hostile note. Before it starts, and again before every agent run, the
  runner refuses (exit code 4) while an approve-button credential is stored in its credential
  directory or in the default `~/.config/homingbird`; it checks that the file exists without reading
  it. The agent command gets the person's environment without `HOMINGBIRD_*`, `HB_*` and any variable
  holding the agent token, and the note only on standard input, wrapped. Storing the approve-button
  credential somewhere the runner does not load would not help: a file the person can read, the agent
  command can read too, and Homingbird has no runtime dependency that could reach an OS keychain. The
  agent credential stays readable to the command; it can draft and read, never approve. A command that
  is not trusted belongs under a separate OS user or in a container (`docs/guide.md`).
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
- **The device flow can issue a second, human credential for an approve button.** A client that asks
  for the `approve` scope and is granted it on the consent screen receives an `approval_token`. The
  model-facing tools never see it.
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

## A topic is a room; helping with a topic is the profile tag

A topic has a slug, a one-line description and one persistent conversation of kind `topic`. "What my
agent can help with" is the set of topics a member helps with, so there is one concept instead of
tags plus rooms. Any person may create a topic; administrators rename, merge and remove them, and
`HB_TOPICS` seeds them.

- **No topic exists unless someone made it, and nobody is put in one.** The server creates exactly the
  topics `HB_TOPICS` lists, joins nobody to them, and adds a new member to no topic. A topic every
  member is forced into would write one event row per member for every note in it, and a channel
  everyone must sit in is not what an organization asked for. A topic named `general` is an ordinary
  topic like any other.
- **When no topic fits, the question goes to a person, or nowhere.** The agent looks for the single
  best topic the member can see; if none fits, it looks in the directory for a colleague whose profile
  or topics match and drafts to them; if nobody fits, it tells its human that it found no
  destination. It never posts one question to several topics.
- When a question moves, the waiting reply drafts of members who are not participants of the new room
  are discarded, and their authors get `draft.discarded`; drafts by members of the new room move with
  the question and their authors get `draft.saved`. A helper outside the new room could neither read
  the question nor send such a draft, only discard it, so the draft only ever waited to be thrown away.
- A question drafted to a topic goes to exactly one room. A question that spans topics goes to the
  best one; posting to several rooms would split the answers.
- The asking agent chooses the topic from `topics.list`; the server does no matching and runs no
  model. The person sees the destination when approving.
- A question is delivered (receipts, inbox, reply drafting) to the topic's helpers. Asking makes the
  asker a participant who can read the room without becoming a helper. A reply is delivered to the
  asker only, and a question with a sent reply leaves the other helpers' inboxes.
- A person in the room may move an unanswered question to another topic. It leaves the old room.
- A draft question is re-addressed in place: `drafts.update` takes an optional `topic` and moves the
  draft to that room, keeping its id, origin, agent name and draft-request link. Only a draft addressed
  to a topic room that is not a reply can move. The route stays `member`, so the drafting agent may
  re-address its own draft: a draft goes nowhere until a person approves it, and the approval screen
  shows the destination. Creating a new draft and discarding the old one would have recorded a
  person as the author of an agent's text.
- Removing or merging a topic archives its room: the conversation keeps its title, becomes a group
  and gets `archivedAt`. Its participants can still read it; drafting, sending, replying or moving a
  question into it is refused with a Conflict, and the drafts waiting in it are discarded
  (`draft.discarded`). A state, not a renamed title, so no client has to guess from text that nothing
  more can be written there.
- `topics.list` puts the topics the viewer is in first, then the fullest, then by slug, a page at a
  time (`limit`, `cursor`, `hasMore`), and `q` searches all of them. An organization can have more
  topics than an agent should read in one call, and the ones a person is in, or that many joined, are
  the likeliest destinations.
- Rule 6 holds unchanged: a topic room is visible only to its participants. Any member may join an
  open one; a private one is joined only through a manager.
- Every participant of a room gets an event row per note, so a note in a topic costs one write per
  participant of its room. This is accepted at the documented single-instance scale; no room holds
  every member unless every member joined it.

## Being in a topic, answering in it and managing it are three things; a topic is open or private

Being able to read a room and being sent its questions are separate, so a person can follow a room
without answering in it, and a team can keep a room to itself.

- **Join and Leave are about being in the room**: reading it and asking in it. Nobody is sent a
  question for being a member. Asking in an open topic still joins you, because an open room is
  readable by anyone who joins anyway; drafting to a private topic needs you to be a member already.
- **"Answer questions here" is a switch only a member has.** On, you are a helper: questions reach you
  and your agent drafts the replies. Off, you stay in the room. Leaving turns it off. The list offers
  "Join" and "Join and answer". "My agent can help with" lists exactly the topics with answering on.
  On the wire the viewer's flags are `joined`, `answering` and `managing`, and "helper" means a member
  who answers.
- **A topic is `open` or `private`.** Private hides a topic from everyone outside it, everywhere: the
  list, search, the directory's chips and `?topic=`, conversations, lookup by slug or room id, events,
  and every tool, command and gateway. A lookup answers exactly as for a topic that does not exist,
  and a taken slug, hidden or not, answers "That name is not available.", so a name probe learns no
  more than that. Any person may create one. Private means hidden from other members, not from the
  organization: administrators can manage every topic and the audit log still holds note content.
- **Managers change a room; the creator is the first.** A manager adds and removes members of a
  private topic, grants and revokes manager, and changes the visibility; nobody joins a private topic
  by themselves, not even an administrator, who adds people as a manager would. A topic with members
  keeps a manager: the last one cannot step down, leave or be removed until another exists. Seeded
  topics have no manager until an administrator names one, and a topic needs a manager in the room
  before it can become private.
- **Open → private keeps everyone in the room; private → open is allowed and audited.** Every
  membership, answering, manager and visibility change is a `human` route, so it is audited and never
  reachable by a model.
- **A private room keeps its questions.** A question in a private topic moves only to another
  private topic with the same members; one moves into a private topic only when the mover and the
  asker are members. A removed member's waiting drafts in the room are discarded and the room drops
  from their clients at once through `topic.left`, which carries only the slug and room id.
- **The web client shows "Private" with a lock, never colour alone.** Korean uses 비공개 and 공개 for
  the visibility, 참여하기 and 나가기 for join and leave, 여기서 질문에 답하기 for the switch, and
  운영자 for a topic manager, because 관리자 already means a server administrator.

## One desk session per person reacts to arriving notes

Each person keeps one agent session open for Homingbird: the desk. In Claude Code it is the session
where the mod's pane is open; for other agents it is the runner, `homingbird run --agent`. Only the
desk holds the event stream, wakes on an arriving note or a draft request, and drafts the reply.
Every other session may draft only when its human asks, and only the desk picks notes up: in any
other session `check_inbox` lists the waiting notes, says which ones an agent is already drafting, and
leaves their status alone, so "drafting reply" tells the sender that the desk is on it. Drafting a
reply still moves the status from any session. This keeps several open sessions from each
drafting a reply to the same note, and gives "agent online" one meaning: the desk is running.

When a reply needs project context, the desk gets it from another session or a read-only helper in
that project. The helper receives the colleague's note only as quoted data and returns facts; it
never drafts. Approval stays where it was: a button in the pane or in the web client.

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
person's own documents, an agent sends `basis` with it, what it read or relied on. That is an audit-log
record for administrators, kept with the draft action and nowhere else: it is in no note, response or
event, and nobody sees it in the product, the author included.

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
