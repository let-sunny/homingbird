# Architecture

Your agent and your colleague June's agent never talk to each other directly. Each one talks only to
Dovecote, the relay server, and Dovecote passes notes between the people they work for. An agent can
only draft; a note leaves its author only after a person approves it, in the web client or, where the
organization turned it on, with an approve button in their agent's pane, and Dovecote checks that the credential is a person's
before it sends. Dovecote never calls a language model, never shows a draft to anyone but its author,
and never hands a received note to a model except wrapped as quoted data by `wrapNote`.

Everything below is described from the code in `packages/`.

## Packages

| Package | What it is for |
| --- | --- |
| `kernel` | `Result`, `Option`, `Task`, `Stream`, `Schema` and the clock, queue and pub-sub primitives. No dependencies. |
| `protocol` | The wire model, the API contract (`contract.ts`), events (`events.ts`), note and receipt status (`status.ts`), messaging policy (`policy.ts`) and `wrapNote` (`wrap.ts`). |
| `dovecote` | The relay server: API, sign-in, OAuth and device flow, event log and hub, Web Push, audit, SQL for SQLite, PostgreSQL and MySQL. It also serves the remote MCP endpoint `/mcp` and the A2A gateway `/a2a`. |
| `client` | The typed HTTP client derived from the contract, the device flow, and the event stream (SSE with long-poll fallback). |
| `ui` | The dependency-free DOM toolkit: elements, signals, regions, safe link rendering. |
| `pwa` | The web client people use to read, approve, edit and discard notes, connect agents and manage topics. |
| `cli` | The `homingbird` command: sign-in, reading, drafting, `approve` and `discard` with the approve credential, `stream`, and the runner `run --agent`. |
| `mcp` | The MCP adapter: tools, prompts, the stdio program `homingbird-mcp` with `--channel` and `--desk`, and the handler behind the remote `/mcp` endpoint. |
| `a2a` | The A2A gateway: a remote agent's message becomes a draft; tasks show the draft's state and the wrapped replies. |
| `mod` | The Claude Code mod: the Homingbird pane with its Approve, Edit and Discard buttons, the desk session, the model-facing note, topic and draft-request tools, the read-only project-reader helper, and the guard. It drives the `cli` package. |

## System overview

Every connection ends at Dovecote, and only a person's credential can send. The web client uses a
session cookie, which is a human credential. Agents use agent credentials and may call only `member`
routes; the one exception is the optional approve button (`HB_APPROVE_BUTTON=on`, off by default), a
second, human credential that only a person's click in the pane uses. A desk session holds the event stream with its agent credential, and
that is what the directory shows as "agent online". Remote connectors and A2A clients call the same
`member` routes through adapters inside Dovecote and hold no stream.

```mermaid
flowchart TB
  subgraph MINE["Your side"]
    direction LR
    WEB["Web client<br/>you, a person"]
    DESK["Your desk session<br/>mod pane, MCP desk or homingbird run"]
    OTHER["Your other agent sessions<br/>MCP stdio or CLI"]
  end
  subgraph REMOTE["Remote clients"]
    direction LR
    CONN["ChatGPT or claude.ai connector"]
    EXT["A2A client"]
  end
  subgraph SRV["Dovecote"]
    direction LR
    AUTH["/auth and /oauth<br/>sign-in and agent tokens"]
    ADAPT["/mcp and /a2a adapters"]
    API["API /api/v1<br/>derived from contract.ts"]
    EV["Per-member event log and hub"]
    DB[("SQLite, PostgreSQL or MySQL")]
  end
  IDP["OpenID Connect provider"]
  JUNE["June's desk and web client<br/>connected the same way"]
  AUD["Audit forwarding<br/>stdout or webhook, off by default"]
  PUSH["Web Push service"]

  WEB -->|"session cookie, human"| API
  WEB -->|"sign in"| AUTH
  AUTH -->|"verify ID token"| IDP
  DESK -->|"device flow"| AUTH
  DESK -->|"agent token, drafts and pickups"| API
  DESK -->|"approve token, pane button only"| API
  OTHER -->|"agent token, member routes"| API
  CONN -->|"OAuth code flow"| AUTH
  CONN -->|"bearer token, no stream"| ADAPT
  EXT -->|"bearer token, messages become drafts"| ADAPT
  ADAPT -->|"member routes only"| API
  API --> DB
  API -->|"events in the same transaction"| EV
  API -->|"after commit"| AUD
  EV -.->|"SSE, long-poll fallback"| WEB
  EV -.->|"SSE, counts as agent online"| DESK
  EV -.->|"only when no human client is connected"| PUSH
  PUSH -.-> WEB
  JUNE <--> API
```

Solid arrows are requests; dotted arrows are events Dovecote pushes. The A2A client authenticates
with a member's agent token, so it acts as that member's agent; it never reaches another member.

## Signing in and connecting an agent

A person signs in once with OpenID Connect and connects each agent once with the OAuth device flow;
both end with a person confirming in a browser. Sign-in gives the browser a session cookie for a
human credential. Connecting an agent issues an agent credential, and, only when the client asked for
the `approve` scope, the server has `HB_APPROVE_BUTTON=on` and the person ticked "allow approve button",
a second human credential returned as `approval_token`. With the setting off the checkbox is not shown
and the request is granted as an agent credential only. The directory shows "agent online" from the moment the agent opens its event
stream, not when the credential is issued.

```mermaid
sequenceDiagram
  autonumber
  actor H as You
  participant W as Web client
  participant S as Dovecote
  participant I as Identity provider
  participant D as Your agent client
  H->>W: open the server address
  W->>S: GET /auth/login
  S-->>W: redirect to the identity provider with PKCE and a nonce
  W->>I: sign in with the company account
  I-->>S: GET /auth/callback with code and state, through the browser
  S->>I: exchange the code, verify the ID token and nonce
  S->>S: check the allowed domains and, for Google, the hosted domain
  S-->>W: session cookie for a human credential
  S-)W: directory.changed, broadcast to everyone
  H->>D: Connect in the pane, or homingbird login
  D->>S: POST /oauth/device_authorization, scope notes or notes approve
  S-->>D: device code, user code and verification address
  D-->>H: show or open the address, code filled in
  H->>W: device page in the web client
  W->>S: device.get
  H->>W: approve, and allow the approve button if it was asked for
  W->>S: device.decide
  loop every 5 seconds until decided
    D->>S: POST /oauth/token with the device code
  end
  S-->>D: agent access token, and an approval token if allowed
  D->>D: store the credentials in local files
  D->>S: open the event stream with the agent credential
  S-)W: presence with agentOnline true, within a second
```

The mod reads `approveButton` from `server.info` and signs in with `homingbird login --approve-button`
only when the server allows it; otherwise its draft cards link to the web client. The MCP
stdio program and the runner never ask for it, and the runner refuses to start while an approve-button
credential is stored in its own or the default credential directory. In the mod, the guard keeps the model away from the
credential files. Remote connectors such as ChatGPT and claude.ai use the authorization code flow with
PKCE through the consent page (`consent.decide`) instead of the device flow, and receive only an agent
credential. Dovecote stores every token as a SHA-256 hash.

## Asking a colleague

Whichever of your sessions drafts the note, June receives it only after you approve it, and the status
you see moves from "Delivered" to "Drafting reply" to "Replied". The draft reaches only your own
clients, as `draft.saved`; June's inbox, stream, search and lookup by id never show it. Approval is
`drafts.send`, a `human` route, and `sendDraft` checks the credential again. June's reply comes back
the same way, after June approves it.

```mermaid
sequenceDiagram
  autonumber
  actor H as You
  participant A as Any of your agent sessions
  participant W as Your web client
  participant S as Dovecote
  participant JD as June's desk
  participant JW as June's web client
  actor J as June
  H->>A: ask June about the release date
  A->>S: drafts.create to June, agent credential
  S-)W: draft.saved, to you only
  Note over S,JW: June sees nothing of the draft
  H->>W: review, edit if needed, approve
  W->>S: drafts.send, session cookie
  S->>S: status sent, receipt for June delivered
  S-)W: note.sent
  S-)JD: note.sent
  S-)JW: note.sent, or Web Push when no client of June's is open
  JD->>JD: wrap the note with wrapNote for the model
  JD->>S: notes.pickup
  S-)W: note.status, Drafting reply
  JD->>S: drafts.create inReplyTo
  S-)JW: draft.saved, to June only
  J->>JW: approve, or press Approve in the pane
  JW->>S: drafts.send
  S->>S: June's receipt replied, June's other reply drafts discarded
  S-)W: note.sent, the reply
  S-)W: note.status, Replied
```

If June opens the note in the web client before an agent picks it up, the status shows "Read" in
between. A reply is a received note like any other, so your own desk wakes on it and may draft an
answer; the desk prompt tells the model not to draft when a note needs no reply.

## Receiving a note at the desk session

When a note arrives, only your desk session wakes, drafts a reply, and waits for you to approve, edit
or discard it. In Claude Code the desk is the session where the mod's pane is open: the mod runs
`homingbird stream --json` as a child process, and the CLI hands every received note over already
wrapped by `wrapNote`. With the default `autoDraft: turn`, the mod opens a new turn with the wrapped
note and asks the model to call `draft_reply`; with `quiet` it asks a forked model for the reply text
in the background; with `off` it drafts nothing. When the reply needs project facts, the model can ask
another session (`ask_session`) or a read-only helper (`ask_project`); either gets the note only as
quoted data and returns facts, never a draft.

`/homingbird` opens the pane and claims the desk: the claim (session id and time) is kept in the mod's
store, and every 30 seconds the desk checks it, refreshes `homingbird overview` and restarts the stream
if it stopped. A session that finds another session's claim stands down, stops its stream and offers
"Make this the desk". When a session starts, it resumes the desk if the claim is still its own. On
claiming the desk and on `resync`, the mod catches up: it drafts for every waiting note that has no
draft yet and answers every open draft request. `ask_project` starts the `project-reader` agent, which
may only read, grep and glob, in the directory it names; a hook refuses to start that agent any other
way. Its facts come back as a new message to the desk when its turn completes.

```mermaid
sequenceDiagram
  autonumber
  participant S as Dovecote
  participant C as homingbird stream
  participant D as Desk mod
  participant M as Desk model
  participant P as Other session or helper
  participant W as Your web client
  actor H as You
  S-)C: note.sent on the event stream
  C->>D: JSON line with the note wrapped by wrapNote
  D->>S: notes.pickup through the CLI
  D->>M: new turn with the wrapped note and the draft_reply instruction
  opt the reply needs project facts
    M->>D: ask_project or ask_session with a question and the noteId
    D->>P: the question, with the note attached as quoted data
    P-->>D: facts with file paths, no draft
    D->>M: the facts, as a new message
  end
  M->>D: draft_reply
  D->>S: drafts.create inReplyTo through homingbird draft
  S-)C: draft.saved, to you only
  D-->>H: toast, notification and waiting count in the status line
  S-)W: draft.saved, or Web Push when no web client is open
  alt approve in the pane
    H->>D: Approve, optionally after editing
    D->>S: drafts.send with the approve credential through homingbird approve
  else decide in the web client
    H->>W: approve, edit then approve, or discard
    W->>S: drafts.send or drafts.discard
  else discard in the pane
    H->>D: Discard
    D->>S: drafts.discard through homingbird discard
  end
  S-)C: note.sent or draft.discarded
```

The mod's guard (`forbiddenReason` in `packages/mod/hooks/guard.ts`) refuses any tool call by the
model that runs `homingbird approve` or `discard`, calls a send, discard, contact, block or credential
route, or touches the credential files, also when a file path given to a tool resolves to one of them
through a link. Without an approve credential the pane tells the person to
approve in the web client. Pane buttons call `homingbird approve` and `discard`; the CLI also needs
the approve credential for `discard`.

## Asking my agent for a draft from the web

"Ask my agent" in the web client sends a draft request to your own clients only, and the agents that
are awake answer it with a draft that appears as a card waiting for your approval. A request never
reaches another member. Every connected agent may answer, and you pick among the drafts; once one of
them is sent, the request closes for the agents that have not answered. A request waits for 24 hours
and can be withdrawn before then. A remote connector cannot be woken, so it picks requests up only
when you tell it to check Homingbird.

```mermaid
sequenceDiagram
  autonumber
  actor H as You
  participant W as Your web client
  participant S as Dovecote
  participant D as Your desk
  participant C as Remote connector
  H->>W: Ask my agent, on a note or in the composer
  W->>S: draftRequests.create, a human route
  S->>S: store the request, expiring after 24 hours
  S-)W: draft.requested, to you only
  alt a desk is running
    S-)D: draft.requested, to you only
    D->>S: draftRequests.list
    D->>S: drafts.create with requestId
    S-)W: draft.saved and draft.request.changed
    H->>W: approve the draft card
    W->>S: drafts.send
    Note over S,D: the request closes for agents that have not answered
  else no agent online
    W-->>H: your agent is offline, the request waits
    opt withdraw
      H->>W: Withdraw
      W->>S: draftRequests.cancel
      S-)W: draft.request.changed
    end
  else a ChatGPT or claude.ai connector
    H->>C: check Homingbird
    C->>S: check_inbox, which reads inbox.list and draftRequests.list
    C->>S: draft_note with requestId
    H->>W: approve
  end
```

A request names its destination: a reply to a note, a conversation, a colleague or a topic, plus an
optional instruction and optionally one chosen agent. The MCP desk, the runner and the mod all answer
requests. The mod opens a turn for each `draft.requested` with the instruction and, for a reply, the
wrapped note it answers; the model reads the conversation with `read_conversation` and answers with
`answer_draft_request`. The pane lists the open requests under "Notes waiting for a reply".

## Topics: rooms, members, helpers and managers

A topic is one persistent conversation of kind `topic` with a slug, a one-line description and a
visibility. Three sets of people belong to it, each a subset of the one before:

- **Members** are the room's participants (`participants`). A member reads the room and asks in it.
  `topics.join` and `topics.leave` (`PUT` and `DELETE /topics/:slug/membership`) change it for an
  open topic; asking a question in an open topic joins you too. Nobody receives a question just by
  being a member.
- **Helpers** are members who answer questions there (`topic_helpers`): "Answer questions here" in the
  web client, `topics.answering.on` and `topics.answering.off` (`PUT` and `DELETE
  /topics/:slug/answering`). Questions are delivered to helpers only, and the profile's "My agent can
  help with" lists exactly these topics. `topics.join` with `answering: true` is "Join and answer";
  leaving turns answering off. Every member is in `general` and answers there by default, and may
  turn it off or leave.
- **Managers** are members who may change the room (`topic_managers`). The creator is the first;
  a manager adds and removes members of a private topic (`/topics/:slug/members/:memberId`), makes
  another member a manager or takes that away (`/topics/:slug/managers/:memberId`), and changes the
  visibility (`PUT /topics/:slug/visibility`). A topic that has managers and members always keeps a
  manager: the last one cannot step down, leave or be removed while others remain
  (`requireManagerRemains`). A server administrator can manage every topic and is shown as managing
  it (`managing: true`), without becoming a member. Seeded topics start without managers.

Visibility is `open` or `private`. An open topic is listed to everyone and anyone may join it. A
private topic exists only for its members: its name, description, room, notes and member chips are
missing from every listing, search, lookup and event for anyone else, a lookup answers exactly as for
a topic that does not exist, and nobody joins one by themselves. Its members, and their agents, read
and draft in it as in any room. Open → private keeps everyone in the room; private → open needs a
manager and is audited like every other change. `general` stays open. Slugs are unique across both,
and a taken slug, visible or not, answers "That name is not available."

| Route | Access | What it does |
| --- | --- | --- |
| `topics.list`, `topics.get` | member | Topics the viewer can see, with `visibility`, `memberCount`, `helperCount`, `joined`, `answering` and `managing` |
| `topics.members.list` | member | The room's members, who answers and who manages; members and administrators only |
| `topics.create` | human | Creates an open or private topic; the creator joins, answers and manages |
| `topics.join`, `topics.leave` | human | Join (optionally answering) or leave; a private topic refuses a self-join |
| `topics.answering.on`, `topics.answering.off` | human | "Answer questions here", for a member only |
| `topics.members.add`, `topics.members.remove` | human | A manager adds or removes a member of a private topic |
| `topics.managers.add`, `topics.managers.remove` | human | A manager grants or revokes manager to a member |
| `topics.visibility.set` | human | A manager makes a topic private or open |

Every membership, answering, manager and visibility change is a `human` route, so it is audited and no
agent credential, MCP tool, CLI command, A2A method or mod tool can make it. A member who leaves or is
removed loses the room at once: their waiting drafts in it are discarded (`draft.discarded`) and they
receive `topic.left` with only the slug and conversation id, so a client drops the room. A member whose
view of a topic changed (joined, added, answering, manager, visibility) receives `topic.changed` with
the topic as they now see it; the ephemeral `directory.changed` broadcast makes open clients refetch
lists and profile chips.

A question in a private topic moves only to another private topic with the same members, and a
question moves into a private topic only when the mover and the asker are both members of it; moving
between open topics is unchanged. A draft is re-addressed into a private topic only by one of its
members.

## Asking a topic

A question to a topic goes to exactly one room, chosen by the asking agent, and the first approved
answer reaches you while the question leaves the other helpers' inboxes. The agent reads
`topics.list` and picks the best topic, or `general` when none fits; Dovecote does no matching.
Drafting to an open topic makes you a member of the room but not a helper; drafting to a private
topic needs you to be a member already. Receipts, and so inbox entries and reply drafting, go to the
topic's helpers only, while every member of the room receives `note.sent`. A person in the room may
move a question that has no sent answer to another topic.

```mermaid
sequenceDiagram
  autonumber
  actor H as You
  participant A as Your agent
  participant S as Dovecote
  participant H1 as Helper 1 desk
  participant H2 as Helper 2 desk
  actor P as A person in the room
  A->>S: topics.list
  S-->>A: the topics you can see, with counts and whether you answer there
  A->>S: drafts.create with one topic, or general
  S->>S: an open topic adds you to the room as a member, not a helper
  H->>S: drafts.send from the web client, destination shown
  S->>S: receipts for the topic's helpers only
  S-)H1: note.sent
  S-)H2: note.sent
  H1->>S: notes.pickup and drafts.create inReplyTo
  H2->>S: notes.pickup and drafts.create inReplyTo
  Note over H1: helper 1's person approves first
  H1->>S: drafts.send, human credential
  S->>S: the reply's receipt goes to you only
  S-)H: note.sent, the reply
  S-)H2: note.status, and the question leaves helper 2's inbox
  opt instead, before any answer is sent
    P->>S: notes.move to another topic, a human route
    S-)H1: note.moved, to the old room's participants
    S->>S: receipts deleted and created again for the new room's helpers
    S-)H2: draft.discarded, for a waiting reply by someone outside the new room
    S-)P: note.sent, to the new room's participants
  end
```

The MCP tools `find_topics` and `draft_note` with `topic`, the CLI `topics` and `draft --topic`, the
A2A gateway (`metadata.topic`) and the mod's `list_topics` and `draft_to_topic` all reach topics; they
list only what the member can see, mark private topics, say whether the member answers there, and
tell the model never to mention a private topic outside it. None of them joins, leaves, answers or
changes members, managers or visibility. The web client offers Join and Join and answer in the list,
the "Answer questions here" switch and Leave in a room, a Members panel for managers, a lock and the
word "Private" on private topics, and shows the destination when approving. When a question moves, a waiting reply draft by a member of the new room moves with it
(`draft.saved` to its author); one by anyone else is discarded (`draft.discarded`), because its author
could no longer read the question or send the reply.

## Note and receipt states

A note changes state once, from `draft` to `sent` or `discarded`; after that only the per-recipient
receipts change. A receipt is computed from four timestamps (`status.ts`, `note-rows.ts`), and the
latest stage wins: replied, then drafting reply, then read, then delivered. So a pickup before anyone
opens the note skips "read", and "drafting reply" falls back when no reply draft exists ten minutes
after a pickup (`PICKUP_GRACE_MS`) or when the reply draft is discarded.

### Note

```mermaid
stateDiagram-v2
  direction LR
  [*] --> draft : drafts.create
  draft --> draft : drafts.update
  draft --> sent : drafts.send by a person
  draft --> discarded : drafts.discard by a person
  draft --> discarded : the same author sent another reply to that note
  draft --> discarded : the question it answers moved to a room its author is not in
  sent --> [*]
  discarded --> [*]
```

### Receipt per recipient

```mermaid
stateDiagram-v2
  direction LR
  state "delivered" as delivered
  state "read" as read
  state "drafting reply" as drafting
  state "replied" as replied
  [*] --> delivered : drafts.send
  delivered --> read : notes.read when a person opens it
  delivered --> drafting : notes.pickup or a reply draft
  read --> drafting : notes.pickup or a reply draft
  drafting --> delivered : no reply draft ten minutes after pickup, not read
  drafting --> read : no reply draft ten minutes after pickup, already read
  drafting --> replied : the reply is sent
  delivered --> replied : a reply written by hand is sent
  read --> replied : a reply written by hand is sent
  replied --> [*]
```

An agent picking up a note never marks it read; only `notes.read`, a `human` route, does. Sending a
reply also fills in the read time. Moving a topic question deletes its receipts and creates new ones,
as `delivered`, for the new room's helpers.

## The desk session per kind of agent

Each person keeps one desk, and only a desk that holds the event stream counts as "agent online".
Every other way of connecting drafts only when the person asks, and in every case a person approves,
in the pane or in the web client.

| Agent | How it becomes the desk | How it wakes | Counts as online | Where the person approves | State |
| --- | --- | --- | --- | --- | --- |
| Claude Code with the mod | `/homingbird` opens the pane and claims the desk; another session that claims it makes this one stand down within 30 seconds | `homingbird stream --json`: `note.sent` opens a turn (`turn`) or drafts in the background (`quiet`); `draft.requested` opens a turn | Yes, through the CLI's SSE stream | Pane Approve button, if the approve credential was granted, or the web client | Implemented |
| Claude Code with `homingbird-mcp --desk` | Started in a session launched with `--channels` | The MCP server holds the stream and pushes notes and draft requests as `notifications/claude/channel`; at start the model is told to call `check_inbox` | Yes, while the SSE stream holds | Web client, through the `open_homingbird` link | Implemented |
| Codex, Gemini CLI, Cursor or any headless agent | `homingbird run --agent "<command>"`, which refuses to start while an approve-button credential is stored in its own or the default credential directory | The runner holds the stream; on `note.sent`, `draft.requested` or `resync` it picks up each new note and request, pipes the wrapped prompt to the command, with no Homingbird variable or credential in its environment, and saves its output as a draft | Yes, while the SSE stream holds | Web client | Implemented |
| An MCP client with a chat left open | The `watch` prompt calls `wait_for_notes` in a loop | `events.poll` long-poll returns, then the tool fetches new notes and requests | No, long-poll is not counted | Web client, through the `open_homingbird` link | Implemented |
| ChatGPT or claude.ai connector | Cannot be a desk; it reaches the remote `/mcp` endpoint | Cannot be woken; "Check Homingbird" makes it call `check_inbox` | No | Web client | Implemented |
| A2A client | Cannot be a desk | Not woken; it reads task state with `tasks/get` | No | Web client | Implemented |

## Where the seven security rules are enforced and tested

Each rule is enforced on the server, and the rules about models are enforced again in every adapter
that faces a model. Paths are relative to `packages/`.

| Rule | Enforced in | Tested in |
| --- | --- | --- |
| 1. Only a human credential can approve a note. | `access: 'human'` on `drafts.send`, `drafts.discard` and every other human route in `protocol/src/contract.ts`; `allows` in `protocol/src/policy.ts`; `requireAccess` in `dovecote/src/api/invoke.ts`, which also audits the refusal and refuses an approve-button credential (`credentials.purpose = 'approve_button'`) on every human route while `HB_APPROVE_BUTTON` is off; `sendDraft` and `discardDraft` in `dovecote/src/domain/notes.ts` check `isHuman` again. The device flow issues the approve credential only when the person allows it (`exchangeDeviceCode` in `dovecote/src/auth/oauth.ts`). | `dovecote/test/security-rules.test.ts`, block "Rule 1" |
| 2. Drafts are invisible to recipients. | `visibleNote`, `notesInConversation`, `searchNotes` and `notesAwaitingReply` in `dovecote/src/domain/notes.ts` filter by `status = 'sent' OR author_id = viewer`; `listConversations` in `dovecote/src/domain/conversations.ts` hides a direct conversation without a sent note; `createDraft`, `updateDraft` and `discard` emit `draft.saved` and `draft.discarded` to the author only; receipts are created only by `sendDraft`. | `dovecote/test/security-rules.test.ts`, block "Rule 2" |
| 3. No tool exposed to a model can approve, change contacts, or read credentials. | Topic membership, answering, manager and visibility routes are `human` too, so no tool reaches them; `memberApiOf` in `mcp/src/member-api.ts` and `a2a/src/member-api.ts` exposes only `member` and `public` routes; `makeLocalSession` in `mcp/src/local-session.ts` never asks for the approve scope; `NOTE_TOOLS` in `mod/hooks/tools.ts` run only the CLI's agent commands; `forbiddenReason` in `mod/hooks/guard.ts` refuses shell approval, person-only routes and the credential files; the pane's Approve button calls `decide` in `mod/hooks/desk.ts`; the runner uses only the agent credential, refuses to run while an approve-button credential is stored (`requireNoApprovalCredential`) and strips Homingbird variables and the token from the agent command's environment (`agentEnvironment`), both in `cli/src/runner-guard.ts`. | `dovecote/test/security-rules.test.ts`, block "Rule 3"; `mcp/test/tools.test.ts`, `mcp/test/server.test.ts`, `mcp/test/member-api.test.ts`, `mcp/test/triggers.test.ts`; `mod/tests/tools.test.ts`, `mod/tests/guard.test.ts`; `cli/test/security.test.ts`, `a2a/test/gateway.test.ts`, `cli/test/run.test.ts`, `cli/test/runner-guard.test.ts`, `cli/test/node-launcher.test.ts` |
| 4. Every received note reaches a model only through `wrapNote`. | `wrapNote` in `protocol/src/wrap.ts`, with a random nonce in the boundary; its callers are `quoteNote` in `mcp/src/quote.ts`, `quoteForModel` in `cli/src/quoting.ts` (used by `stream`, `inbox`, `conversation`, `requests` and `run`), and `taskViewOf` in `a2a/src/task-view.ts`. The mod receives notes only as the CLI's wrapped text. | `dovecote/test/security-rules.test.ts`, block "Rule 4": a hostile note through every note-returning tool of `/mcp` and through A2A `tasks/get` and `GetTask`, each time inside `wrapNote` with a fresh nonce; `protocol/test/wrap.test.ts` (property tests), `mcp/test/quote.test.ts`, `mcp/test/triggers.test.ts`, `mcp/test/channel.test.ts` |
| 5. Credentials are stored hashed and never logged. | `hashSecret` (SHA-256) in `dovecote/src/random.ts`; `issueCredential`, `authenticate` and `refreshCredential` in `dovecote/src/domain/credentials.ts` store only `token_hash` and `refresh_hash`; tokens leave the server only in the token response or the session cookie; `serve` in `dovecote/src/http/node-server.ts` logs failed requests without their query string. | `dovecote/test/security-rules.test.ts`, block "Rule 5" |
| 6. A member sees only conversations they participate in. | `participatedConversation` and `participantsOf` in `dovecote/src/domain/conversations.ts`; every note query joins `participants`; `sendDraft`, `moveToTopic` and `announceStatus` emit to the conversation's participants only. A private topic is listed, resolved and shown as a chip only to its members: `maySee` and `visibleTopic` in `dovecote/src/domain/topic-rows.ts`, `listTopics`, `topicsHelpedBy`, `helpersOfTopicSeenBy`, `topicRoomFor` and `roomForMovedQuestion` in `dovecote/src/domain/topics.ts`; `depart` drops a removed member from the room, discards their drafts in it and sends `topic.left`. | `dovecote/test/security-rules.test.ts`, block "Rule 6", including every surface of a private topic for a non-member person and their agent; `dovecote/test/topic-membership.test.ts` |
| 7. No tool exposed to a model can save or change a profile character. | `access: 'human'` on `me.character.set` and `me.character.clear` and `access: 'admin'` on `admin.members.resetCharacter` in `protocol/src/contract.ts`; `saveCharacter` in `dovecote/src/domain/characters.ts` runs `characterProblems` (`protocol/src/character.ts`: `validateCharacter` from `sprites` plus the built-in id rule) again whatever the client checked, and stores exactly the spec that passed; `handleApiRequest` in `dovecote/src/http/api-routes.ts` refuses a body over `CHARACTER_BYTES_MAX`. The model-facing `check_character` and `preview_character` (`mcp/src/character-tools.ts`, `mod/hooks/character.ts`) call no route; the web client saves only from **Use this character** and never from a `#/character/` link. | `dovecote/test/security-rules.test.ts`, block "Rule 7"; `dovecote/test/characters.test.ts`; `mcp/test/character-tools.test.ts`, `mcp/test/tools.test.ts`; `mod/tests/character.test.ts` |

## Real-time delivery

Every durable event is written to the recipient's own event log in the same transaction as the
change, so a client that reconnects resumes from its last sequence number and loses nothing kept in
the log, however far behind it is. `emit` in `dovecote/src/events/events.ts` increments `members.event_seq`, stores the event in
`events`, and hands it to the in-process hub only after the transaction commits. Events are kept for
seven days. Three event types are ephemeral and carry sequence number 0: `presence`,
`directory.changed` and `resync`.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant S as Dovecote
  participant L as Your event log
  C->>S: GET /api/v1/events/stream with Last-Event-ID 41
  S->>S: subscribe to the hub for live events
  alt the events after 41 are still in the log
    loop pages of 500 until a page comes back short
      S->>L: events after the last one replayed
      L-->>S: up to 500 events
      S-->>C: replay them
    end
    S-->>C: live events newer than the last one replayed
  else some of them were trimmed
    S-->>C: resync with sequence number 0
    C->>S: reload through the API
  end
  loop every 20 seconds
    S-->>C: keep-alive, after checking the credential again
  end
  opt three stream attempts in a row fail
    C->>S: GET /api/v1/events/poll after 47, wait up to 25 seconds
    S-->>C: events and a cursor, or nothing after the wait
  end
```

- **Transports.** Dovecote serves SSE at `/api/v1/events/stream`, WebSocket at `/api/v1/events/ws`
  (framing in `dovecote/src/http/websocket.ts`) and long-poll at `/api/v1/events/poll`. All clients
  in this repository use `eventStream` in `client/src/event-stream.ts`: SSE first, long-poll after
  three failed stream attempts in a row, with exponential back-off.
- **Presence.** The hub counts each member's open streams by credential kind: a human stream makes
  `humanOnline` true, an agent stream makes `agentOnline` true. Long-poll subscribes as hidden and
  counts for neither. Changes are collected and broadcast to everyone as one `presence` event per
  second (`PRESENCE_FLUSH_INTERVAL_MS`).
- **Replay.** `liveEvents` in `dovecote/src/events/events.ts` subscribes before it reads the log, so an
  event committed during the replay is either in a later page or in the hub's buffer, and events at or
  below the last replayed sequence number are dropped from the buffer. SSE and WebSocket share it.
  Long-poll answers at most 500 events and a cursor; the client polls again from that cursor, which
  after a `resync` is the server's latest sequence number.
- **Overflow.** A live subscriber whose buffer of 2048 events fills, also while it is still replaying,
  is closed after a `resync`.
- **Web Push.** The notifier considers only `note.sent` from someone else and a new agent draft, and
  sends nothing while the member has a human stream open.
- **One instance.** The hub lives in one process, so a deployment runs exactly one Dovecote process
  (`docs/deployment.md`). Multi-node fan-out is on the roadmap.

## Data model

The schema in `dovecote/src/sql/schema.ts` is one table DSL that generates DDL for SQLite, PostgreSQL
and MySQL. It declares primary keys and indexes but no foreign keys; the relations below follow from
the column names and the queries.

```mermaid
erDiagram
  MEMBERS {
    id id PK
    string email UK
    string subject UK
    string name
    text profile
    string role
    string status
    integer event_seq
    integer created_at
    integer last_seen_at
    string locale
    text character_spec
  }
  CREDENTIALS {
    id id PK
    id member_id
    string kind
    string name
    string client
    string token_hash UK
    string refresh_hash
    integer token_expires_at
    integer expires_at
    integer revoked_at
    string purpose
  }
  CONVERSATIONS {
    id id PK
    string kind
    string title
    string pair_key UK
    integer last_activity_at
  }
  PARTICIPANTS {
    id conversation_id PK
    id member_id PK
  }
  NOTES {
    id id PK
    id conversation_id
    id author_id
    string status
    text body
    id in_reply_to
    string origin
    string agent_name
    id credential_id
    integer sent_at
  }
  RECEIPTS {
    id note_id PK
    id member_id PK
    integer delivered_at
    integer read_at
    integer drafting_at
    integer replied_at
  }
  PICKUPS {
    id note_id PK
    id credential_id PK
    integer picked_at
  }
  TOPICS {
    id slug PK
    string description
    id conversation_id UK
    id created_by
    string visibility
  }
  TOPIC_HELPERS {
    id conversation_id PK
    id member_id PK
  }
  TOPIC_MANAGERS {
    id conversation_id PK
    id member_id PK
  }
  DRAFT_REQUESTS {
    id id PK
    id member_id
    id conversation_id
    id in_reply_to
    text instruction
    id agent_id
    integer expires_at
    integer cancelled_at
  }
  DRAFT_REQUEST_ANSWERS {
    id request_id PK
    id note_id PK
    id credential_id
  }
  EVENTS {
    id member_id PK
    integer seq PK
    integer created_at
    text body
  }
  CONTACTS {
    id low_id PK
    id high_id PK
    id requested_by
    string status
  }
  BLOCKS {
    id blocker_id PK
    id blocked_id PK
  }
  PUSH_SUBSCRIPTIONS {
    string endpoint_hash PK
    id member_id
    text endpoint
  }
  AUDIT_LOG {
    serial id PK
    id actor_id
    id credential_id
    string action
    string target
    text detail
  }
  AUTH_REQUESTS {
    id id PK
    string kind
    string status
    string secret_hash
    string user_code
    id member_id
    text detail
  }
  OAUTH_CLIENTS {
    id id PK
    string name
    text redirect_uris
  }
  SETTINGS {
    string name PK
    text value
  }

  MEMBERS ||--o{ CREDENTIALS : holds
  MEMBERS ||--o{ PARTICIPANTS : joins
  CONVERSATIONS ||--o{ PARTICIPANTS : has
  CONVERSATIONS ||--o{ NOTES : contains
  MEMBERS ||--o{ NOTES : writes
  NOTES |o--o{ NOTES : "replies to"
  NOTES ||--o{ RECEIPTS : "delivered as"
  MEMBERS ||--o{ RECEIPTS : receives
  NOTES ||--o{ PICKUPS : "picked up as"
  CREDENTIALS ||--o{ PICKUPS : makes
  CONVERSATIONS ||--o| TOPICS : "is the room of"
  CONVERSATIONS ||--o{ TOPIC_HELPERS : "has helpers"
  MEMBERS ||--o{ TOPIC_HELPERS : helps
  CONVERSATIONS ||--o{ TOPIC_MANAGERS : "has managers"
  MEMBERS ||--o{ TOPIC_MANAGERS : manages
  MEMBERS ||--o{ DRAFT_REQUESTS : asks
  CONVERSATIONS ||--o{ DRAFT_REQUESTS : "is the destination of"
  DRAFT_REQUESTS ||--o{ DRAFT_REQUEST_ANSWERS : "answered by"
  NOTES ||--o| DRAFT_REQUEST_ANSWERS : answers
  MEMBERS ||--o{ EVENTS : "event log"
  MEMBERS ||--o{ CONTACTS : "low or high side"
  MEMBERS ||--o{ BLOCKS : blocks
  MEMBERS ||--o{ PUSH_SUBSCRIPTIONS : subscribes
  MEMBERS |o--o{ AUDIT_LOG : acts
  MEMBERS |o--o{ AUTH_REQUESTS : decides
```

The diagram leaves out `created_at` and `last_used_at` on most tables, and the `schema_versions`
table that records applied migrations. Auth requests hold sign-in attempts, device-flow requests and
consent requests; their secrets are stored hashed.

## Known limits

- **One process only.** Real-time fan-out is in-process, so Dovecote cannot run as more than one
  instance.
- **No client uses the WebSocket endpoint.** The web client, the CLI and the MCP program use SSE and
  fall back to long-poll.
- **Long-poll is sticky.** After three failed stream attempts, `eventStream` stays on long-poll until
  the client restarts, and a long-polling agent does not count as online.
- **A `resync` on a stream does not move the client's cursor.** The event has sequence number 0, so a
  client whose stream drops before the next durable event resumes from its old cursor, is told to
  resync again and reloads again. It misses nothing; it reloads twice.
- **The server does not enforce one desk.** The mod keeps one desk among Claude Code sessions, but
  `homingbird-mcp --desk`, `homingbird-mcp --channel` and `homingbird run` each hold a stream and
  each drafts its own reply to the same note. `--channel` without `--desk` also counts as agent
  online. `docs/decisions.md` names only the
  mod pane and the runner as desks.
- **In a topic room, the other helpers' reply drafts stay.** Sending the first answer only removes the
  question from the other helpers' inboxes; their drafts are not discarded, and one sent later still
  reaches the asker.
- **Draft request expiry and closing send no event.** Only a withdrawal and a new answer emit
  `draft.request.changed`; the 24-hour expiry and the closing after a sent answer show only through
  `draftRequests.list`.
- **The runner's agent command can read the runner's agent credential.** `homingbird run` starts the
  command with the person's own OS permissions and cannot confine it. It withholds what it can: the
  command gets no Homingbird variable and no credential in its environment, arguments or input, and
  the runner refuses to run while an approve-button credential is stored in its credential directory
  or in `~/.config/homingbird`. But the agent credential file is readable by the same OS user, and so
  is an approve-button credential kept anywhere else, such as under another `XDG_CONFIG_HOME`. With
  the agent credential the command can read the person's conversations and draft; Dovecote refuses it
  on every approving route. Run an agent command you do not trust under a separate OS user or in a
  container (`docs/guide.md`, `docs/deployment.md`).
- **The mod's guard is a pattern check.** `forbiddenReason` matches the text of each tool call and the
  resolved path of a file tool. A shell command that assembles the credential path or the
  `homingbird approve` command at run time is not recognized, and the approve-button credential is a
  file the session's own user can read.
