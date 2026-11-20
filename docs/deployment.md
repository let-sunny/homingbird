# Deploying Dovecote

**Run one Dovecote process on a small machine. For up to about 1,000 members and 1,200 notes a minute,
we estimate that 1 vCPU and 1 GB of memory is enough; for a pilot team, half of that.** These sizes
are estimates from one load measurement on SQLite on a shared machine, not a guarantee; see
[Measurements](#measurements) and size with your own load. Dovecote is single-instance
only: live event fan-out and presence live in the process, so a second instance would miss the first
one's notes. Scale up, never out.

| Load | CPU | Memory | GCP | AWS |
| --- | --- | --- | --- | --- |
| Pilot: up to 100 members, up to 100 notes/min | 0.5 vCPU | 512 MB | `e2-small`, or Cloud Run 1 vCPU / 512 MiB | `t4g.small`, or Fargate 0.5 vCPU / 1 GB |
| Organization: up to 1,000 members, up to 1,200 notes/min | 1 vCPU | 1 GB | `e2-medium`, or Cloud Run 1 vCPU / 1 GiB | `t4g.medium`, or Fargate 1 vCPU / 2 GB |
| Large, **unverified**: up to 5,000 members, up to 3,000 notes/min | 2 vCPU | 4 GB | `e2-standard-2`, or Cloud Run 2 vCPU / 4 GiB | `m7g.large`, or Fargate 2 vCPU / 4 GB |

With PostgreSQL, start the managed database at Cloud SQL `db-custom-1-3840` or RDS `db.t4g.small`, and
move up one size for the large row.

## Contents

- [Outside services](#outside-services)
- [Measurements](#measurements)
- [One instance only](#one-instance-only)
- [Choosing a database](#choosing-a-database)
- [Behind a load balancer](#behind-a-load-balancer)
- [Backups](#backups)
- [When someone leaves](#when-someone-leaves)
- [Logs](#logs)
- [Product analytics](#product-analytics)
- [Answering flow](#answering-flow)
- [Insights](#insights)
- [Features](#features)
- [Web push](#web-push)
- [Cloud desk](#cloud-desk)
- [Connecting claude.ai](#connecting-claudeai)
- [Running the desk runner on a server](#running-the-desk-runner-on-a-server)
- [Run a channel's agent on a server](#run-a-channels-agent-on-a-server)
- [Roll out to an organization](#roll-out-to-an-organization)
- [Configuration](#configuration)
- [Ready-made setups](#ready-made-setups)

**Experimental parts.** Experimental: tested automatically, not yet used in a real deployment. This applies to the A2A gateway (`/a2a`), the Terraform configurations
for GCP and AWS, and MySQL support.

## Outside services

**A deployment needs one outside service: an OpenID Connect identity provider for sign-in.** Everything
else runs in the one Dovecote process, on Node 22.18 or later or the container image.

| Needed | What | When |
| --- | --- | --- |
| Always | Node, or the image | Dovecote is one process with no runtime dependencies |
| Always | A database | SQLite is a file next to the process; no database server is needed |
| Always, except development login | An OpenID Connect identity provider | Google by default, or any issuer in `HB_OIDC_ISSUER`. Development login (`HB_DEV_LOGIN=1`) needs none and is refused unless `HB_PUBLIC_URL` is a loopback address |
| Recommended | TLS in front | Dovecote speaks plain HTTP; a load balancer or reverse proxy serves `https` ([Behind a load balancer](#behind-a-load-balancer)) |
| Optional | PostgreSQL or MySQL | Instead of SQLite, when `HB_DATABASE_URL` names one ([Choosing a database](#choosing-a-database)) |
| Optional, outbound | Browser push services | Only when people turn on phone notifications; only the hosts in `HB_PUSH_HOSTS` ([Web push](#web-push)) |
| Optional, outbound | OAuth client metadata | Only when someone connects claude.ai; only the hosts in `HB_OAUTH_CLIENT_METADATA_HOSTS` ([Connecting claude.ai](#connecting-claudeai)) |
| Optional, outbound | Cloud agent services | Only with the experimental cloud desk switched on; only the hosts in `HB_WAKE_HOSTS` ([Cloud desk](#cloud-desk)) |
| Optional, outbound | An analytics endpoint | Off unless `HB_ANALYTICS` names one ([Product analytics](#product-analytics)) |

No mail server, message broker, cache, object store, key management service or vendor account is
needed, and Dovecote calls no model: agents run on people's own machines or runners, or, with the cloud
desk, in a service the person woke.

## Measurements

These numbers come from `pnpm load-test` on SQLite, on one noisy shared machine. Treat them as rough.

| Members | Open streams | Load | CPU | RSS | p95 send |
| --- | --- | --- | --- | --- | --- |
| 100 | 200 | exchanges at a steady rate | 22–30 ms per exchange | 115–135 MB | 7 ms |
| 1,000 | 2,000 | 1,200 notes/min | 0.19 core | about 483 MB | 6 ms |

An exchange is two notes (a question and its reply) and six API calls. Both runs work out to roughly 10
to 15 ms of CPU per note, and about 0.2 MB of memory per open event stream on top of roughly 90 MB for
the process.

What follows from that, and has **not** been measured:

- Node runs Dovecote's JavaScript on one thread, so one busy core is the ceiling. At 10–15 ms per note,
  one core saturates somewhere around 4,000–6,000 notes a minute. Plan to stay below half of that. A
  second vCPU still helps, because garbage collection, TLS and the database driver run beside the main
  thread.
- Memory grows with open streams, not with members: 10,000 open streams need about 2 GB.
- The measurements were direct conversations. **A note in a channel room writes one event row per
  participant of that room**, because every participant gets an event per note. A channel that 1,000
  people joined costs 1,000 writes per note. Dovecote puts nobody in a channel by itself, so a room is as
  large as the people who joined it.

### At pilot size

**At pilot size, every call we measured answers within a quarter of a second at the 95th percentile, on
SQLite and on PostgreSQL.** The slowest is the organization's Insights page, at about 85 ms typically and
under 230 ms at the 95th percentile; everything else stays under 120 ms at the 95th percentile.

`npx tsx scripts/pilot-measure.ts` seeds a pilot on a fresh SQLite file and times the calls that grow with
history; `--database-url postgres://…` runs it on PostgreSQL, **dropping Dovecote's tables in that
database first**, so point it only at a scratch database. The pilot is
50 members, each with 2 agents (100 agent credentials), 20 channels with every member in 6 of them and 4
people answering in each, 30 days of history at about 200 notes a day (3,000 exchanges: 5,036 sent notes,
5,582 notes with drafts, 9,838 receipts and 122,636 event rows, since housekeeping is not run), and 10
open debate rooms with 5 agents each. Four in five drafts come from an agent; seven in ten are sent as
written, two edited and one discarded, and one reply in twenty is given back. The calls go over HTTP
to a server in the same process, one at a time. For the fan-out, 100 agent streams are open and one note
is sent to a channel all 50 members joined; the time runs from the send until the last stream has it.

Measured on 4 vCPUs (Intel Xeon at 2.1 GHz, shared), 16 GB of memory, Node 22.23, with SQLite on local
disk and PostgreSQL 16 on the same machine:

| What | Runs | SQLite median | SQLite p95 | PostgreSQL median | PostgreSQL p95 |
| --- | --- | --- | --- | --- | --- |
| Organization Insights (`GET /admin/insights`) | 20 | 83 ms | 226 ms | 83 ms | 159 ms |
| The administrator's own figures (`GET /insights/me`) | 20 | 6 ms | 11 ms | 6 ms | 14 ms |
| Each member's trust figures (`GET /insights/me`, all 50) | 50 | 6 ms | 11 ms | 6 ms | 12 ms |
| Each member's principles with this week's figures (`GET /principles`) | 50 | 9 ms | 30 ms | 16 ms | 23 ms |
| One channel note to 100 open streams, until the last arrives | 20 | 61 ms | 90 ms | 71 ms | 117 ms |
| Debate asks for every agent (`GET /debate-asks`, 100 agents) | 300 | 2 ms | 6 ms | 7 ms | 19 ms |

Seeding took about 3.5 minutes on SQLite and 5.5 on PostgreSQL. No call came near the 500 ms we treat as
slow, so no index was added for the pilot. Organization Insights reads the drafts and sent notes of the
last 60 days into memory: it grows with an organization's history, and is the first figure to measure
again before a pilot several times this size.

## One instance only

Real-time fan-out and presence are in process (see [decisions](decisions.md#architecture)). Two
instances behind one load balancer would each deliver only the notes they handled themselves, and
presence would disagree between them. Nothing warns you; notes simply arrive late, at the next resync.

- Run exactly one process. On Cloud Run set minimum and maximum instances to 1; on ECS set the desired
  count to 1 with a deployment that stops the old task before starting the new one.
- A deployment is therefore a short outage. Clients reconnect and resume from their last event sequence
  number, so no event is lost.
- For availability, rely on the platform restarting the process and on the database's own high
  availability, not on a second Dovecote.

Horizontal scaling (shared fan-out through the database or a broker) is on the
[roadmap](roadmap.md#operations).

## Choosing a database

| Database | Use it when | `HB_DATABASE_URL` |
| --- | --- | --- |
| SQLite (default) | One VM or one Docker host with a persistent disk | `sqlite:/data/dovecote.sqlite` |
| PostgreSQL | Cloud Run, Fargate, or anywhere the container's disk is not persistent | `postgres://user:password@host:5432/homingbird` |
| MySQL 8 (experimental) | Your organization already runs MySQL | `mysql://user:password@host:3306/homingbird` |

- SQLite is built into Node (`node:sqlite`), needs no driver and is the fastest option on one machine.
  Keep the file on a local or block disk, never on a network file system.
- The container image includes the `pg` and `mysql2` drivers. Running from source, install the one you
  need: they are optional peer dependencies of `@homingbird/dovecote`.
- The whole server test suite runs against PostgreSQL 16 and MySQL 8 in CI.
- MySQL support: Experimental: tested automatically, not yet used in a real deployment.

### Upgrading

- Dovecote creates its tables on first start. The 0.1.0 schema is one baseline, recorded as version
  1. Step 2 adds the columns and tables for the agent figures and teaching; a 0.1.0 database gets it
  on its next start and keeps every row. Step 3 adds the debate room tables and the column that
  links a posted debate result to its room; a database at step 2 gets it on its next start. Step 4
  adds the tables for every agent's draft of a room's result and the votes on them, and the time a
  room's vote opened; a database at step 3 gets it on its next start, and on MySQL a step cut off
  halfway runs again.
- Step 6 adds groups. It gives every channel its own unnamed group of managers: the channel's current
  managers who are still active and in the room, so every manager keeps their channel, or nobody. The
  old `channel_managers` table stays and is no longer read. A channel's group is shown only to people
  who can see the channel; teams, which administrators make and name, are shown to everyone. Turn groups
  off with `HB_FEATURES=groups=off` ([Features](#features)); every channel keeps its managers.
- A `schema_versions` table records which schema steps a database has, and Dovecote applies the missing ones in order when it starts, each in its own
  transaction. There are no down-migrations.
- Dovecote refuses to start on a database it did not make: one that records a version this build does
  not know, or that holds its tables with no version recorded. It says so in one sentence and changes
  nothing. A database from a 0.1.0 release candidate is such a database: recreate it, starting from an
  empty one.
- A server rolled back to an older version refuses a database a newer one migrated, because it records
  a step that version does not know. Back up before upgrading, and restore that backup to roll back.

**Supported upgrades:**

- A database any final release left, from 0.1.0 on, upgrades to any later release: start the newer
  Dovecote on it and it applies the steps it lacks, in order. Releases may be skipped; 0.1.0 straight to
  the newest works. Release candidates are not covered.
- Upgrade the server and the clients together ([Mixing versions](#mixing-versions)). The web client
  comes with the server; update people's command lines and MCP adapters to the same release.
- Every change is tested this way, so every release is: CI starts it on a database each earlier final
  release left, on SQLite, PostgreSQL and MySQL, checks that every row stays and the audit chain
  verifies, and starts it again after a start cut off halfway through the upgrade.

**To upgrade:**

1. Read the [changelog](../CHANGELOG.md) for every release you skip, for settings that changed.
2. [Back up](#backups) the database, and check that the backup opens.
3. Stop the old server, and start the new one on the same database. It upgrades the database before
   it serves, and records the steps it applied in a `system.migrated` audit event.
4. Run `dovecote audit verify` on the host ([Logs](#logs)); it says the chain holds.

To roll back, stop the new server and restore the backup; the older server refuses the upgraded
database.

**Upgrading to the release with the new audit trail:**

- The audit trail moves to a new table, `audit_events`, added by a new schema step. The first table,
  `audit_log`, which held request bodies and note content, is no longer written and its rows are not
  copied. At the first start of this version Dovecote removes its rows older than the audit retention
  your administrator had saved (`HB_AUDIT_RETENTION_DAYS`, 400 days by default, when none was saved),
  and records how many in an `audit.legacy_purged` row; after that, retention removes the rest with
  the same cutoff as new rows. When the saved retention was **keep forever**, nothing is removed at
  the upgrade. To remove them all at once, run `dovecote audit purge-legacy` on the
  host.
- The audit view in the web client and the `GET /api/v1/admin/audit` route are gone: the trail is read
  on the server host ([Logs](#logs)). A script that called that route gets 404.
- `HB_AUDIT_WEBHOOK_URL` is no longer read; Dovecote warns once at start while it is set. Collect
  stdout instead, with `HB_LOGS=auditCopy=on` for a metadata-only copy of the audit trail.
- `HB_AUDIT_STDOUT=1` still works and means `HB_LOGS=auditCopy=on`.
- `HB_AUDIT_RETENTION_DAYS` is now the only retention control, 400 days unless set, at least 90. The
  administrator's retention setting in the web client is gone. A retention your administrator saved is
  never shortened silently: while `HB_AUDIT_RETENTION_DAYS` is unset, a saved value longer than 400
  days keeps rows that long, and a saved **keep forever** keeps every row, so housekeeping removes
  none. When the variable is set it decides, and whenever the retention kept is shorter than the saved
  one Dovecote writes one `system.audit_retention_shorter` warning at start, naming both (`saved` is
  `"forever"` for keep forever).
- A value of `HB_AUDIT_RETENTION_DAYS` below 90, which 0.1.3 accepted, no longer stops Dovecote:
  it starts, keeps rows for 90 days, and warns once with `system.audit_retention_raised`. Raise the
  variable to 90 or more to silence it.
- The Terraform modules for AWS and Google Cloud no longer have an `audit_webhook_url` variable, and
  no longer pass `HB_AUDIT_WEBHOOK_URL` to the server. Remove it from your `terraform.tfvars`:
  Terraform warns about a value for an undeclared variable, and `-var audit_webhook_url=...` on the
  command line is an error.
- Lines on stdout are now JSON objects ([Operational log](#operational-log)), not free text.

### Mixing versions

Upgrade the server and people's command lines and MCP adapters together where you can: mixed versions
are not tested. Clients read values a newer server added safely (an unknown status as not sent, an
unknown role as no administrator, an unknown relation as no contact), skip an event they cannot read,
and use only the features `server.info` lists as on. At start they compare the server's
`protocolVersion`, which changes only with a breaking change announced in the changelog; a client that
cannot read it says in one sentence which side to upgrade: "This Homingbird server is newer than this
client understands; upgrade the client." The web client is served by Dovecote itself, so a reload
always brings the matching one.

## Behind a load balancer

Set **`HB_TRUST_PROXY`** to the number of proxies in front of Dovecote, and only when Dovecote is
reachable only through them. Dovecote then takes the client address for rate limiting and the audit
log from `X-Forwarded-For`, counting that many entries from the right: each proxy appends the address
it saw, so the entries to the left of the ones your proxies added are whatever the client sent and are
ignored. `0`, the default, uses the connection's own address. Never set it on a server the internet
can reach directly.

| In front of Dovecote | `HB_TRUST_PROXY` |
| --- | --- |
| Nothing, or a TCP load balancer that does not add the header | `0` |
| One proxy that appends the client address (AWS Application Load Balancer, nginx with `$proxy_add_x_forwarded_for`, Caddy) | `1` |
| Google Cloud's external Application Load Balancer, which appends the client address and then its own | `2` |
| A CDN in front of one of the above | add one for the CDN |

If unsure, log the header once from a known address and count the entries after it.

Set `HB_PUBLIC_URL` to the address people use, with `https`. Dovecote builds OAuth, MCP and cookie
settings from it.

### Long-lived connections

Clients hold one event stream each: Server-Sent Events at `/api/v1/events/stream` or a WebSocket at
`/api/v1/events/ws`. Dovecote sends a heartbeat every 20 seconds on both, so any idle timeout of 30
seconds or more holds. What cuts streams is a limit on the total length of a request:

| Platform | Setting | What to set |
| --- | --- | --- |
| Cloud Run | Request timeout, at most 3,600 s | 3,600 s. Streams are cut hourly and resume. |
| GCP external Application Load Balancer, VM or instance-group backend | Backend service timeout, 30 s by default; for WebSockets it limits the whole connection | 3,600 s or more |
| GCP load balancer, serverless (Cloud Run) backend | The backend service timeout does not apply | Use the Cloud Run timeout |
| AWS Application Load Balancer | Idle timeout, 60 s by default, at most 4,000 s | The default holds; 3,600 s leaves room for a buffering proxy in front |
| AWS Network Load Balancer | TCP idle timeout, 350 s | Holds with the 20 s heartbeat |

Make sure nothing between the client and Dovecote buffers responses: a buffering proxy holds back the
heartbeat and the events with it.

## Backups

- **SQLite:** take an online copy without stopping the server. The image has no `sqlite3` binary, but
  Node does the job:

  ```sh
  docker exec dovecote node -e "new (require('node:sqlite').DatabaseSync)('/data/dovecote.sqlite').exec(\"VACUUM INTO '/data/backup.sqlite'\")"
  ```

  Then move `backup.sqlite` off the machine. Copying the database file alone while the server runs is
  not a backup: recent writes sit in the `-wal` file beside it.

  To restore it:

  1. Stop Dovecote.
  2. Delete `dovecote.sqlite-wal` and `dovecote.sqlite-shm` beside the database. Left in place, SQLite
     replays the old write-ahead log onto the restored file: it then holds writes made after the
     backup and fails its integrity check.
  3. Replace `dovecote.sqlite` with the backup, keeping its name and owner.
  4. Run `dovecote audit verify` with the server's settings; it says the chain holds.
  5. Start Dovecote. Notes, members and sessions are as they were when the backup was taken; anything
     written after it is gone, and people signed in since then sign in again.
- **PostgreSQL and MySQL:** use the managed service's automated backups with point-in-time recovery.
  Both Terraform setups turn them on.
- The database holds note content, the audit trail, hashed credentials and, with the cloud desk on,
  wake tokens sealed with `HB_SECRETS_KEY`. Encrypt backups and restrict who can read them; keep the
  key elsewhere.

## When someone leaves

**Deactivate the member in Homingbird; blocking their company account is not enough.** An
administrator opens **Administration**, **Members** in the web client and presses **Deactivate**
(the API route `admin.members.update` with `status: deactivated`). At once:

- every credential of that member is revoked: browser sessions, and every agent credential, whether
  it came from the command line, the runner, the Claude Code plugin, an MCP adapter or a connector such
  as claude.ai. Their next request answers 401, refreshing a connector's token is refused, and an open
  event stream ends at its next heartbeat, within 20 seconds;
- a sign-in they approved that no program has finished yet, a device code or a connector's
  authorization code, is refused when the program comes to collect it;
- they leave every group, so they stop managing channels, and every credential they issued to a
  channel's agent is revoked; a channel's agent itself keeps the credentials its remaining managers
  issued;
- they disappear from the directory, and nobody can address a new note to them;
- signing in again is refused, even while their company account still works;
- their cloud desk's wake address and token are deleted.

**Reactivate** in the same place lets them sign in again; their agents must sign in again too,
because revoked credentials stay revoked. The deactivation itself is audited. Rule 6 in
`packages/dovecote/test/security-rules.test.ts` holds the credential points of this list for each kind
of credential.

What stays: notes they sent remain in their conversations for the other participants, and the audit
trail keeps its rows about them, ids and outcomes only, until `HB_AUDIT_RETENTION_DAYS` removes them
(400 days by default). Their unsent drafts stay in the database and no one else can see them.

Limits:

- Nothing syncs with the identity provider. There is no SCIM ([roadmap](roadmap.md#operations)), so
  deactivation is a manual step in your offboarding.
- Blocking the company account alone stops new sign-ins, but credentials already issued keep working
  until they expire: a browser session after `HB_SESSION_DAYS` (30 days by default), an agent
  credential after `HB_AGENT_CREDENTIAL_DAYS` (90 days by default). Refreshing an
  agent's token does not extend that.

## Logs

**Dovecote keeps five kinds of record, each for its own reader, and none of them holds the content of
a note, a draft, a basis, a principle or a debate turn except the product's own data.**

| Kind | Answers | Reader | Where |
| --- | --- | --- | --- |
| Audit trail | Who changed who may do what, and who was refused? | The operator, and auditors through them | Table `audit_events`, database only |
| Activity | What happened in my conversations, drafts, principles, rooms? | The people concerned, in the product | The product's own tables |
| Operational log | Is the server healthy, and why did that request fail? | The operator's log collector | JSON lines on stdout |
| Service log | Why did my background agent stop? | The person, on their own computer | `homingbird run` log file |
| Product analytics | Which parts of Homingbird are used? | Whoever the operator sends them to | Off unless set up ([Product analytics](#product-analytics)) |

### Choosing what is recorded

One variable, read at start like `HB_FEATURES`. It is the operator's: no web setting overrides it, and
`server.info` does not show it.

```sh
HB_LOGS="audit=full,operational=info,requests=off,auditCopy=off"   # the defaults
```

| Kind | Values | Default | What it means |
| --- | --- | --- | --- |
| `audit` | `full`, `security`, `off` | `full` | `security` keeps sign-in, credentials, refused attempts and refused tokens, roles and status, settings, retention and start; `full` adds channels, contacts, principles, characters, approvals and debate rooms. `off` records nothing; Dovecote warns once at start |
| `operational` | `debug`, `info`, `warn`, `error`, `off` | `info` | The lowest level written to stdout. `debug` adds the redacted detail of defects; Dovecote warns that it is not for production |
| `requests` | `on`, `off` | `off` | One `http.request` line per request: route name, method, status and duration |
| `auditCopy` | `on`, `off` | `off` | Each audit row also as an `audit.copy` line on stdout, without its detail. `HB_AUDIT_STDOUT=1` means the same |

An unknown name or value, a name given twice, an item such as `audit=full=x`, and any choice that would
silently drop output it asks for (`auditCopy=on` or `requests=on` with `operational` below `info`) stop
Dovecote at start with one sentence that says which.

### The audit trail

Every row is written in the same transaction as the action it records, and rolls back with it. It
holds ids, enums, the outcome and, for settings, the values before and after; never a request body,
note content, a token, a cookie or an email address. The client address and user agent are kept only
on sign-in, sign-out, failed sign-in and credential issue rows.

| Column | Holds |
| --- | --- |
| `id`, `created_at` | Order and time (milliseconds since 1970) |
| `event`, `outcome` | A catalogue name such as `note.approved`, and `success`, `denied` or `failed` |
| `actor_id`, `credential_id`, `credential_kind`, `client_id` | Who acted, with which credential, and the OAuth client when one did |
| `target_kind`, `target_id` | What it is about: a member, note, channel, principle, debate, route, … |
| `request_id` | The request's `X-Request-Id`, also on its operational log lines |
| `client_address`, `user_agent` | Sign-in and credential rows only |
| `detail` | JSON declared per event in `packages/protocol/src/audit-events.ts` |
| `previous_hash`, `hash` | The hash chain |

Recorded: approving and discarding a note; credentials renamed, revoked and issued; device and consent
decisions; which profile fields changed; characters set, cleared and reset; role and status; settings;
channels created, made open or private, joined, left, archived, renamed, and their members and managers;
contacts and blocks; principles created, changed, deleted and reordered, without their text; debate
rooms opened, agents opted in, limits, results decided, posted and exported; sign-in, failed sign-in
and sign-out; OAuth clients registered and resolved; retention purges; start and schema steps;
refused attempts as `authz.denied`, one row per credential and route a minute with a `count`; and a
missing, expired or revoked token as `authn.token_refused`, one row a minute per credential, or per a
hash of the token when no credential has it, never the token. Such refusals also write one
`authn.refused_burst` warning a minute per address, cut to its /24 or /48. A window is written within
ten seconds of its minute ending, and every open window when Dovecote stops. A credential's row names
the kind of program it went to (`browser`, `cli`, `mcp`, `plugin`, `oauth`, or `device` for an older
client) and the OAuth client id, never the name the program gave itself. Not
recorded, because they are activity the product already keeps or a read: every `GET`, reading, moving,
picking up and releasing notes, drafting and editing drafts, when a draft was first seen, debate turns,
drafted results and votes, push subscriptions and presence.

A detail that does not match its schema never fails the action: the row is kept with
`{"invalidDetail":true}` and an `audit.invalid_detail` warning is written.

**Tamper evidence.** Each row's `hash` is SHA-256 over the previous row's hash and the row itself; the
first row follows 64 zeros. A one-row table, `audit_head`, holds the newest hash and serialises
writers. Once a day the head goes to the operational log as `audit.chain_head`, so a copy lives
outside the database. A retention purge removes the oldest rows as one piece, remembers the last hash
it removed and records `audit.retention_purged`, so what is left still verifies.

**This detects changes; it does not prevent them.** Whoever can write the database can change a row and
recompute every hash after it, and `verify` will then say the chain holds. To detect that too, keep the
latest hash somewhere the database's writers cannot reach: the daily `audit.chain_head` line in a log
store they cannot edit, or the head `verify` prints, saved with each `export`. A head you kept must
still appear in a later chain, or as a later purge's `lastRemovedHash`; if it does not, the trail was
rewritten. After a retention purge the oldest remaining row links to the hash the purge remembered,
so removed rows are no break; a writer who deletes the oldest rows and changes that memory too is
caught only by a head or an export kept elsewhere.

**Retention.** `HB_AUDIT_RETENTION_DAYS`, 400 days unless set, at least 90: a smaller value is raised
to 90 with a warning at start. While it is unset, a longer retention an administrator saved before
this setting moved to the variable is kept, and a saved keep forever keeps every row. The hourly housekeeping pass removes older rows, and rows
of the first audit table, `audit_log`, with the same cutoff.

**On the server host**, with the same `HB_DATABASE_URL` as the server:

```sh
node dovecote.mjs audit verify                               # in the image: docker compose exec dovecote node dovecote.mjs audit verify
node dovecote.mjs audit export --since 2026-11-01 > audit.jsonl
node dovecote.mjs audit export --since 2026-11-01 --until 2026-12-01
node dovecote.mjs audit purge-legacy                         # removes every row of the first audit table
```

`verify` walks the chain up to the head it read when it started, so rows the server writes meanwhile
wait for the next run and a retention purge meanwhile is no break; it says where the chain breaks and
exits 1. `export` writes one JSON object per row. The commands never migrate or seed: a database of
another version is refused with exit code 3 and one sentence. None has a network route: the trail is
read where the database is.

Recipes, for PostgreSQL; SQLite and MySQL differ only in date functions:

```sql
-- Everything one credential did
SELECT created_at, event, outcome, target_kind, target_id FROM audit_events
WHERE credential_id = 'cred_...' ORDER BY id;

-- Who changed roles or status, and how
SELECT created_at, actor_id, target_id, detail FROM audit_events
WHERE event = 'member.access_changed' ORDER BY id;

-- Refused attempts in the last day
SELECT created_at, credential_id, target_id AS route, detail FROM audit_events
WHERE event = 'authz.denied' AND created_at > (extract(epoch FROM now()) * 1000 - 86400000)::bigint;

-- A channel's membership history
SELECT created_at, event, actor_id, detail FROM audit_events
WHERE target_kind = 'channel' AND target_id = 'payroll' ORDER BY id;

-- Failed sign-ins by reason
SELECT detail, count(*) FROM audit_events WHERE event = 'authn.sign_in_failed' GROUP BY detail;
```

Give Dovecote's database role `INSERT, SELECT, DELETE` on `audit_events` and nothing more if your
database allows it, and auditors a separate read-only role.

**Private channels are private from other members, not from the organization.** A private channel is
hidden from everyone outside it in the web client, the API and every agent tool. The audit trail
records who joined it, left it and changed it, never its notes; but administrators can manage every
channel, and anyone who can read the database can read its notes. Tell your members so; the user guide
says it too.

### Operational log

One JSON object per line on stdout, with OpenTelemetry field names so a collector maps it without
configuration:

```json
{"timestamp":"2026-11-19T10:02:03.123Z","severityText":"ERROR","severityNumber":17,
 "eventName":"http.request_failed","body":"A request failed with a defect.",
 "attributes":{"route":"drafts.send","method":"POST","defect":"TypeError","requestId":"req_6f2c..."},
 "resource":{"service.name":"dovecote","service.version":"0.1.4"}}
```

Every line is one of a fixed set of events, each with a fixed sentence and typed attributes; there is
no free-form message. Lines never carry tokens, cookies, authorization headers, query strings, request
or response bodies, note or principle text or email addresses. A defect is logged by the name of its
type; its detail appears only at `debug`, with tokens, cookies, query strings, email addresses and
long secrets removed. Every response carries `X-Request-Id`, the same id as on that request's log lines
and audit rows. Dovecote keeps no log of its own: retention is the collector's.

A start failure still goes to stderr as one sentence, because there is nowhere else to say it.

## Product analytics

**Off unless the operator chooses a destination and an administrator turns the `analytics` feature
on.** Then the web client and the command line send anonymous counts to this Dovecote only, which
checks each against its catalogue, replaces each anonymous id with an HMAC under a key it made at
first start, so nothing a client puts there leaves as sent, and forwards them from a bounded queue
in the background. One credential may send 60 events a minute; more are refused with 429. The catalogue
(`packages/protocol/src/analytics.ts`) holds enums and short codes only, never content, names or email
addresses: `sign_in_completed {client}`, `page_viewed {page}` (a web client route name),
`principle_saved {kind}`, `draft_approved`, `debate_opened {visibility}`, `desk_started {agentPreset}`
(a preset name or `custom`). An unknown event or
property refuses the whole batch. Events carry a random id kept in the browser or on the computer,
never the member.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HB_ANALYTICS` | `off` | `posthog` (batch capture API), `ga4` (Measurement Protocol) or `http` (our own Segment-shaped JSON, `{"events":[{"event","properties","anonymousId","timestamp"}]}`) |
| `HB_ANALYTICS_URL` | PostHog US cloud for `posthog` | Where events go. For `ga4`, the collect address with `?measurement_id=G-...` |
| `HB_ANALYTICS_KEY` | none | The PostHog project key, the GA4 API secret, or a bearer token for `http`. Never logged |

The command line says once that the server counts usage; `homingbird analytics off` or
`DO_NOT_TRACK=1` stops it on that computer. The MCP adapter sends none and says so in its status.

## Answering flow

An administrator can set one answering flow for the server: steps every member's desk follows before
drafting, and checks it runs on each draft before a person sees it. Set it as `answeringFlow` on
`PUT /api/v1/admin/settings` with an administrator's session, or in the web client's administration
settings, where the steps are two lists, each step with a switch to turn it off, edited in place and
put in order; the audit trail records that it changed, not its text. A turned off step is stored with "[off] " in front and
never reaches an agent. Write each step by the outcome you want, not by a tool, because members' agents differ
in what they have; the [guide](guide.md#answering-flow) shows the format. The flow is not shown to
members but reaches each member's agent, so never put confidential material in it.

## Insights

Every member sees their own agent's numbers under **My agent** ([guide](guide.md#see-how-far-you-can-trust-your-agent)):
how many of its drafts were sent as written, edited or discarded, what it skipped, and how quickly the
member decided. Administrators see **Insights** in the administration area: people who sent notes,
notes per person, reply rate and typical time to the first reply, the approval mix, the share of quick
approvals and of skipped notes, debate results sent (a line of their own: they count neither as agent
drafts nor as notes), the typical time from seeing an agent draft to deciding, who wrote what was sent
(the agent as written, edited by its person, or by hand), delivery to agents (notes received, those
received by someone with an agent connected, picked up within 5 minutes, the typical pickup time, and
those that waited a day without an agent picking them up), quick approvals week by week over 8 weeks,
and totals per channel. When at least 25% of the drafts sent as written were quick approvals in each of
the last two weeks, each with at least 10 such drafts, Insights show a warning that approving may be
becoming a formality. Insights hold numbers only, never note content and never one person's figures:

- With the default `HB_INSIGHTS_MINIMUM_GROUP` of 1, nothing is hidden. Raised, it hides as follows.
- A period in which fewer than `HB_INSIGHTS_MINIMUM_GROUP` people sent notes shows no
  numbers at all, and the block count is shown only as a number, and only once the organization has
  that many members.
- A channel, or direct messages together, appears on its own only when at least that many people
  contributed to it. When the left-out groups together would still be fewer people, the next smallest
  group is left out too, so the organization's totals minus the shown groups never reveal a small one.
- Debate results sent are shown only once at least that many people sent one in the period.
- Each newer figure needs its own people: the typical decision time needs that many people who decided
  a draft they had seen; who wrote what is hidden whenever draft decisions are; a week of quick
  approvals is hidden as the draft decisions of the same days are; delivery needs that many people
  with an agent connected who received a note, its typical pickup time that many whose agent picked
  one up, and its total of notes received that many people without an agent, or none.
- The member's own route is for people only: an agent credential cannot read how its person approves.

Principles that members teach their agents ([guide](guide.md#my-agent)) are private to each member and
never appear in Insights. The audit trail records that a principle was created, changed or deleted, never its text.

Two settings shape the numbers. Both apply to everything already recorded, because Dovecote stores
times, not verdicts:

- `HB_QUICK_APPROVAL_SECONDS` (default `3`): a draft sent as written within this many seconds of first
  appearing on its person's screen counts as a quick approval.
- `HB_INSIGHTS_MINIMUM_GROUP` (default `1`): the smallest group whose numbers are shown. The default
  shows every group, since Insights measure how agents are doing; raise it, for example to `5`, to hide
  smaller groups and anything that would let the shown totals give one away. Raised, it also leaves out
  noticeably more channel rows: when the left-out channels together are fewer people, or nobody known,
  the next smallest is left out too.

The figures are computed when the page is opened, from the last 60 days of notes, decisions and skips.
Teams get rows of their own, alphabetically: people who sent notes, notes sent, draft decisions,
quick approvals, the typical decision time and skips, counting a person for a team on every UTC day
they were in it. With a raised minimum, a team is left out when it, or a group of people who share the
same teams, is smaller, and the page says how many teams were left out. With groups switched off, no
team row is shown.

## Features

An administrator can turn optional features off under **Administration → Settings → Features**. A
feature that is off disappears from the web client, its routes answer 404 "This feature is turned off in
this organization.", agents are told nothing about it, and its data is kept for when it is turned on
again. Every change is audited. `server.info` lists which features are on, so every client adapts.
`analytics` is off by default and stays off while `HB_ANALYTICS` is `off`.

| Switch | Default | When it is off |
| --- | --- | --- |
| `channels` | on | People can no longer create channels; existing channels stay |
| `draftRequests` | on | People can no longer ask their agent for a draft from the web client |
| `characters` | on | Everyone shows as the pigeon; nobody can change a character |
| `webPush` | on | No notifications reach phones or computers |
| `mute` | on | Nobody can mute a direct message or a channel or choose what notifies them; stored choices are kept and ignored |
| `answeringFlow` | on | Agents draft without the organization's steps |
| `teaching` | on | Principles are kept but not used, and nobody can add one (the route map goes too) |
| `agentFigures` | on | People no longer see their agent's figures |
| `routeMap` | on | My agent shows no route map |
| `insights` | on | Administrators see no organization-wide numbers |
| `noteDetails` | on | Notes no longer show the model and program that wrote them |
| `groups` | on | Groups are hidden and frozen: nobody creates, renames or changes a team or a channel's managers, nor adds a team to them; every channel keeps its managers, who still run it |
| `debateRooms` | on | Debate rooms are hidden, agents take no turns and no room stops on time; the rooms stay |
| `cloudDesk` | **off** | No cloud desk is woken and nobody can set one up; saved wakes are kept. Offered only with `HB_SECRETS_KEY` ([Cloud desk](#cloud-desk)) |
| `analytics` | **off** | No usage counts leave the server ([Product analytics](#product-analytics)) |

Notes, drafts, approval, direct messages, sign-in and the audit trail are the core and cannot be turned
off. `HB_FEATURES` seeds the switches at first start, such as `HB_FEATURES="teaching=off,characters=on"`;
once an administrator saves settings, the saved switches win.

## Web push

The web client can notify a person of arriving notes and of drafts waiting for approval. Dovecote signs
the requests (VAPID) and encrypts the payloads itself; the keys are generated on first use and stored in
the database. It needs outbound HTTPS to the browsers' push services, and accepts subscriptions only for
the hosts in `HB_PUSH_HOSTS`, matching subdomains too:

```
fcm.googleapis.com, updates.push.services.mozilla.com, push.apple.com, notify.windows.com
```

If your egress is filtered, allow those hosts (and their subdomains). Set `HB_PUSH_HOSTS` only to narrow
the list.

## Cloud desk

Experimental. A person can run their desk in a cloud agent service, such as a Claude routine, and have
Dovecote wake it when work waits ([guide](guide.md#wake-a-cloud-desk)). To offer it:

1. Generate a key and give it to Dovecote as a secret, like `HB_OIDC_CLIENT_SECRET`:

   ```sh
   openssl rand -base64 32
   ```

   `HB_SECRETS_KEY` seals each person's wake address and token. It never appears in a log or in
   `server.info`. Keep it outside the database and its backups: a backup alone does not open the tokens.
   Losing or changing it makes every saved wake unreadable; people then set theirs up again. There is
   no rotation tool yet.
2. Turn on `cloudDesk` under **Administration → Settings → Features**, or with
   `HB_FEATURES=cloudDesk=on`. Without a key the switch has no effect.
3. Allow outbound HTTPS to the hosts in `HB_WAKE_HOSTS`, `api.anthropic.com` by default. A wake address
   must be on one of them exactly, subdomains not included; `none` allows none.

What the server does and keeps: each wake is one `POST` with a fixed body that says only that work
waits and where, sent at most every five minutes for work and every three for a debate room, never while
the person's agent is online, and never following a redirect. Each successful wake starts a new session
at the service, which may be paid and is rate limited there (a Claude routine allows 30 an hour). Wakes
go to the operational log as `desk_wake.fired` and `desk_wake.unanswered`, with the member id, host and
status; the audit trail keeps `desk_wake.registered`, `desk_wake.removed` and `desk_wake.stopped` with
the host only. Deactivating a member deletes their wake. The pending wakes live in memory, which fits
[one instance](#one-instance-only).

## Connecting claude.ai

Dovecote is a remote MCP server with its own OAuth authorization server, so claude.ai can use it as a
custom connector.

1. Make sure Dovecote is reachable from the internet at `HB_PUBLIC_URL` over `https`.
2. In claude.ai, add a custom connector with the URL **`https://homingbird.example.com/mcp`**. It must be
   the resource URL including `/mcp`, not the bare server address.
3. Leave the OAuth client fields empty. claude.ai identifies itself with a client metadata document, and
   Dovecote accepts those from `claude.ai` and `claude.com` by default (`HB_OAUTH_CLIENT_METADATA_HOSTS`).
4. claude.ai redirects back to `https://claude.ai/api/mcp/auth_callback`. That callback may move to
   `https://claude.com/api/mcp/auth_callback`; both hosts are allowed by default
   (`HB_OAUTH_REDIRECT_HOSTS`), so either works without a change.
5. Each person connects once, signs in, and consents. The connector gets an agent credential: it can
   read and draft, never send. Drafts wait for approval in the web client.

A client that cannot use metadata documents or dynamic registration can be registered up front with
`HB_OAUTH_CLIENTS`.

## Running the desk runner on a server

`homingbird run --agent "<command>"` can run next to Dovecote or on any machine that reaches it, so a
team can keep desks for headless agents (Codex CLI, Gemini CLI, Cursor agent) running without a laptop.
The agent command runs with the permissions of the OS user that runs the runner, so:

- **Give each runner its own OS user or container**, with only that person's `homingbird login` in it.
  The agent command can read every file that user can read, including the runner's agent credential
  (`$XDG_CONFIG_HOME/homingbird` or `~/.config/homingbird`). With it, an agent can read that person's
  conversations and draft, never send: Dovecote refuses agent credentials on every approving route.
- Nothing a runner signs in with can approve: a device sign-in issues an agent credential only, and
  approval happens in the web client, where the person signs in themself.
- **Never run it as the user that runs Dovecote**, which can read the database and `HB_*` secrets. The
  runner removes `HOMINGBIRD_*` and `HB_*` variables from the agent command's environment, but files are
  another matter.
- The runner holds an event stream, so the person's agent shows as **awake** while it runs.

### A complete example: one person's runner on a Linux server

A server has no browser where the person can approve a sign-in, so the person signs in once on their
own machine and hands the runner the credential as a file. The steps below set up one person's runner
on a Linux server with systemd, as a dedicated OS user, `hb-ana` here, and Claude Code as the agent;
replace the server address, the user and the agent with yours. Every command is meant to be copied as
it is. The systemd unit passes `systemd-analyze verify` but has not yet been loaded by a real user
manager in our tests, so check step 6 before you rely on it.

**1. On your own machine, sign in to a file.** You approve in the web client as always. The agent
credential (the server's address and the token) goes to that file only, readable by you only
(`0600`); the command prints where it wrote it, never the token, and refuses to replace an existing
file without `--force`. `--name` is what the web client calls this connection under **My agent** →
**Connection**, and its drafts show as **Runner · build-1**.

```sh
homingbird login --server https://homingbird.example.com \
  --credentials-file ./homingbird.json --name build-1
scp ./homingbird.json admin@build-1:/tmp/homingbird.json
rm ./homingbird.json
```

Or store the file as a secret, such as in GCP Secret Manager, and have the server's startup script
fetch it; either way, delete your local copy.

**2. On the server, as root: the runner's user, Node, the command line and the agent.** The user
gets no password and no `sudo`. Lingering lets its own systemd user manager run without anyone
logged in.

```sh
useradd --create-home --shell /bin/bash hb-ana
loginctl enable-linger hb-ana
npm install -g @homingbird/cli @anthropic-ai/claude-code   # Node 22 or newer is already installed
```

**3. Put the credential where the runner can read it and nothing can change it.** The file belongs to
the runner's user and is read-only (`0400`) in a directory only root can write, so neither the runner
nor its agent can replace or delete it. In a container, mount it read-only instead, such as
`--mount type=bind,src=/etc/homingbird/hb-ana/homingbird.json,dst=/run/secrets/homingbird.json,readonly`.

```sh
install -d -o root -g root -m 0755 /etc/homingbird/hb-ana
install -o hb-ana -g hb-ana -m 0400 /tmp/homingbird.json /etc/homingbird/hb-ana/homingbird.json
shred -u /tmp/homingbird.json
```

**4. Give the agent its model key in an environment file only that user can read.** The runner passes
its own environment to the agent command, except `HOMINGBIRD_*` and `HB_*` variables, so a systemd
drop-in that loads the file gives the agent its key. The drop-in sits beside the unit that `service
install` writes and survives a reinstall. The service's name is `homingbird-runner-` followed by the
server address with its scheme, as `service install` prints it.

```sh
UNIT=homingbird-runner-https-homingbird-example-com.service
sudo -u hb-ana sh -c 'umask 077 && cat > /home/hb-ana/model.env' <<'KEY'
ANTHROPIC_API_KEY=<the key>
KEY
sudo -u hb-ana mkdir -p /home/hb-ana/.config/systemd/user/$UNIT.d
printf '[Service]\nEnvironmentFile=/home/hb-ana/model.env\n' |
  sudo -u hb-ana tee /home/hb-ana/.config/systemd/user/$UNIT.d/model-key.conf > /dev/null
```

If your shell keeps a history of what you paste, write the key with an editor as `hb-ana` instead,
and keep the file at mode `0600`.

**5. Install the service as that user.** `service install` refuses to run as root. It writes the path
of the credentials file, never its content, into the unit as `HOMINGBIRD_CREDENTIALS_FILE`, and starts
the service.

```sh
as_runner() { sudo -iu hb-ana env XDG_RUNTIME_DIR=/run/user/$(id -u hb-ana) "$@"; }
as_runner homingbird service install --server https://homingbird.example.com --agent claude \
  --credentials-file /etc/homingbird/hb-ana/homingbird.json
```

**6. Check that it runs.** `service status` says whether the service is installed and running, how it
last exited and where its log is; the log has one line per step, never note text or tokens. In the web
client, the person's agent shows as **awake**.

```sh
as_runner homingbird service status --server https://homingbird.example.com \
  --credentials-file /etc/homingbird/hb-ana/homingbird.json
as_runner tail -n 20 /home/hb-ana/.config/homingbird/logs/runner-https-homingbird-example-com.log
```

**7. Rotate the credential** when the person leaves the machine, suspects it was copied, or on your own
schedule. Sign in to a new file and copy it to `/tmp/homingbird.json` as in step 1, then on the
server, as root:

```sh
install -o hb-ana -g hb-ana -m 0400 /tmp/homingbird.json /etc/homingbird/hb-ana/homingbird.json
shred -u /tmp/homingbird.json
as_runner systemctl --user restart homingbird-runner-https-homingbird-example-com.service
```

Then revoke the old connection under **My agent** → **Connection** in the web client; it is the older
of the two with the same name. Rotate the model key the same way: edit `/home/hb-ana/model.env` and
restart the service. To stop for good, run `as_runner homingbird service uninstall --server
https://homingbird.example.com`, revoke the
connection in the web client, and delete `/etc/homingbird/hb-ana` and the secret.

What the runner does with the file: it only reads it. It refuses a file that is missing, unreadable,
not a credential or for another server than `--server`, and warns when the file's group or other users
can read it. A service waits until the file can be used, and waits for a new file when the server
refuses the one it holds. The agent command's environment never holds the variable or any value
containing the path, and its arguments and input never hold the path. The runner's own command line
does when you pass `--credentials-file` to `homingbird run`, and other users of the computer can list
it; the variable keeps the path off it, which is why the systemd unit and the launchd agent use it.
Either way the agent command runs as the same OS user and can read the file, as it can read
`~/.config/homingbird`: the credential can read and draft, never send. `homingbird logout
--credentials-file <path>` revokes the credential and deletes the file only where it may; for the
read-only file above it says so, and you delete it yourself.

## Run a channel's agent on a server

A [channel's agent](guide.md#a-channels-agent) should keep answering when nobody's laptop is on. Run it
with `homingbird run` on a server, as its own OS user, next to a checkout of what it answers from, such
as the team's wiki. It is the same runner as in [Running the desk runner on a
server](#running-the-desk-runner-on-a-server), with three differences:

- **A manager connects it, from their own browser, while the server waits.** `homingbird login` on the
  server prints a link and a code. A manager of the channel opens the link in the web client, where
  they are signed in, and under **Connect it as** chooses **Payments wiki, the agent of
  #payments-wiki** instead of **My own agent**. Nothing has to be copied between machines: the
  credential is written on the server, and it is the agent's, not the manager's.
- **What it can do is the channel's, not a person's.** The credential reads the channel's room and the
  private questions asked of the agent, and drafts replies there. It cannot send, approve, message
  anyone, or read any person's conversations, the managers' included; the server refuses all of that to
  every agent credential, and to a channel's agent in particular.
- **Its answers wait for the channel's managers**, under **Answers waiting for you** on the channel's
  agent page (`#/channel/<slug>/agent`). The person who asked never sees the draft, and a manager never
  reviews the answer to their own question, so a pilot needs at least two managers.

### A complete example: #payments-wiki answering from the wiki's repository

The steps below run the agent of `#payments-wiki` on a Linux server with systemd, as the OS user
`hb-payments-wiki`, with Claude Code as the agent and a read-only checkout of the wiki in
`/srv/payments-wiki`. Replace the server address, the channel and the agent with yours. A channel's
agent must already exist: a manager creates it under **Channel agent** in the channel's room, with
channel agents switched on ([Features](#features)).

**1. As root: the agent's own user, Node, the command line and the agent.** One OS user per channel's
agent: the service's name comes from the server address, so one user runs one runner per server, and
each agent can then read only its own credential and its own checkout.

```sh
useradd --create-home --shell /bin/bash hb-payments-wiki
loginctl enable-linger hb-payments-wiki
npm install -g @homingbird/cli @anthropic-ai/claude-code   # Node 22 or newer is already installed
```

**2. As root: the checkout, which the agent can read and not change.** It belongs to another user and
is kept up to date by a timer of that user, or by your deployment; the agent only reads it.

```sh
install -d -o root -g root -m 0755 /srv/payments-wiki
git clone https://git.example.com/payments/wiki.git /srv/payments-wiki
chmod -R go-w /srv/payments-wiki
```

**3. Connect the agent.** On the server, as the agent's user, sign in to a file in a directory only that
user can read, and send the printed link to a manager of the channel. `--name` is what the managers see
under **Desks connected as Payments wiki**, with who approved it.

```sh
as_agent() { sudo -iu hb-payments-wiki env XDG_RUNTIME_DIR=/run/user/$(id -u hb-payments-wiki) "$@"; }
as_agent homingbird login --server https://homingbird.example.com --no-browser \
  --credentials-file /home/hb-payments-wiki/.config/homingbird/payments-wiki.json --name wiki-server
```

The manager opens the link, checks the code, chooses the channel's agent under **Connect it as** and
approves. The command then says `Signed in to https://homingbird.example.com as Payments wiki, the
agent of #payments-wiki.` and where the managers review its answers. If it names a person instead, the
manager chose **My own agent**: run `homingbird logout --credentials-file <the file>` and connect
again.

The file holds only the server's address and the agent's token, is created with mode `0600`, and is
never replaced without `--force`; the command prints its path, never the token. To make it read-only
for the runner as well, move it into a root-owned directory as in step 3 of [the person's
example](#a-complete-example-one-persons-runner-on-a-linux-server).

**4. Give the agent its model key**, as in step 4 of the person's example, in an environment file only
`hb-payments-wiki` can read, loaded by a systemd drop-in.

**5. Install the service**, with the checkout as its working directory and the agent limited to reading
it. `service install` writes the credentials file's path into the unit, never its content.

```sh
as_agent homingbird service install --server https://homingbird.example.com \
  --credentials-file /home/hb-payments-wiki/.config/homingbird/payments-wiki.json \
  --workdir /srv/payments-wiki \
  --agent "claude -p --tools 'Read,Grep,Glob' --strict-mcp-config --no-session-persistence" \
  --split --reader "claude -p --tools '' --strict-mcp-config --no-session-persistence"
```

- `--workdir` is the directory the agent command starts in, so the agent answers from the checkout.
- `--tools 'Read,Grep,Glob'` gives Claude Code only its tools for reading files, and
  `--strict-mcp-config` no MCP server: it cannot run commands, edit files or reach the web. With
  `claude -p` nobody is there to grant a permission, so what needs one is refused anyway; limiting the
  tools makes that explicit. `--no-session-persistence` keeps Claude Code from saving each run's
  transcript, questions included, under the user's home directory.
- `--split` keeps the questions' own words away from the agent that has tools: a reader without tools
  describes each question first, and the agent drafts from that description ([split
  mode](guide.md#keep-the-drafting-agent-away-from-the-notes-wording-split-mode)). A command of your own
  needs `--reader`; without it the runner uses the agent command as the reader and warns.
- The `codex` preset runs with `--sandbox workspace-write`. For a channel's agent give `--agent` a
  Codex command with `--sandbox read-only` instead, or keep the checkout unwritable as above.

We checked these Claude Code options against `claude --help` of Claude Code 2.1.329; we have not yet run
this exact command against a model in our tests.

**6. Check that it runs.** `service status` and the log are as in the person's example; the log has one
line per step, such as `Drafted note_… in reply to note_…`, never a question, an answer or a token. In
the web client, a question asked in `#payments-wiki` shows **Drafting reply** to the person who asked,
and the draft appears under **Answers waiting for you** for the other managers.

```sh
as_agent homingbird service status --server https://homingbird.example.com \
  --credentials-file /home/hb-payments-wiki/.config/homingbird/payments-wiki.json
```

### In a container

The same holds in a container: one container per channel's agent, running as a user without
privileges, with the credentials file and the checkout mounted read-only and the checkout as the
working directory. Connect the agent once with `homingbird login --credentials-file` written to the
host directory you mount, then start the runner with `HOMINGBIRD_CREDENTIALS_FILE` rather than
`--credentials-file`, so the path stays off its command line. Use an image of your own with Node, the
command line and the agent; we do not publish one.

```sh
docker run -d --name hb-payments-wiki --restart unless-stopped --user 10001:10001 \
  --env-file /etc/homingbird/payments-wiki/model.env \
  -e HOMINGBIRD_CREDENTIALS_FILE=/run/secrets/homingbird.json \
  --mount type=bind,src=/etc/homingbird/payments-wiki/homingbird.json,dst=/run/secrets/homingbird.json,readonly \
  --mount type=bind,src=/srv/payments-wiki,dst=/wiki,readonly \
  --workdir /wiki registry.example.com/homingbird-agent:1 \
  homingbird run --server https://homingbird.example.com \
    --agent "claude -p --tools 'Read,Grep,Glob' --strict-mcp-config --no-session-persistence" \
    --split --reader "claude -p --tools '' --strict-mcp-config --no-session-persistence"
```

`homingbird run` outside a service stops with exit code 3 when the server refuses its credential; the
restart policy then starts it again, and each start says so in the container's log until you mount a
new file. This example has not been run in our tests.

### Rotate, disconnect, and when a manager leaves

- **Rotate** before `HB_AGENT_CREDENTIAL_DAYS` (90 by default) run out, since the agent's credential is
  not refreshed, and whenever you suspect the file was copied: connect again to a new file as in step 3,
  point the service at it (`service install` again with the new path, or replace the file and restart
  the service), then disconnect the older desk of the same name.
- **Disconnect** is open to any manager of the channel, under **Desks connected as …** on the channel's
  agent page, not only to the one who approved it. The runner's next request is refused; a service then
  waits for a new file, and its log says so.
- **When the manager who approved it stops managing the channel**, or is deactivated, every credential
  they approved for the agent is revoked at once. The agent stops answering until another manager
  connects it again as in step 3. Retiring the agent or archiving the channel disconnects it as well.
- **To stop for good**, run `as_agent homingbird service uninstall --server
  https://homingbird.example.com`, disconnect the desk, and delete the credentials file and the model
  key.

### What this does not protect

- **Whoever runs the machine reads everything the agent reads.** The OS user's owner, and anyone with
  root, can read the credential and so every question asked in the channel or asked of the agent
  privately, and every draft the agent writes, before any manager approves it. The model's provider
  receives the same text. Run the agent on a machine whose operators may read the channel, and tell the
  people who ask privately: the private question's first screen names only the channel's managers.
- **A model may carry knowledge from one question to the next.** Every run of the agent command is a new
  process, and the server keeps the credential to this channel's rooms. What the agent itself keeps
  between runs, in its own memory, files it may write or a provider's history, Homingbird cannot see.
  Keep its tools read-only, give it no place to write, and run one agent per OS user.
- **The checkout is what the agent knows.** Anything in it can end up in a draft; the managers' review
  is the check before it reaches the person who asked.

## Roll out to an organization

Install the command line and register each person's runner centrally, with MDM (Jamf, Intune) or an
onboarding script, so that people only open the web client. Every script does two things:

1. Install the CLI: `npm install -g @homingbird/cli` (Node 22 or newer must already be installed).
2. As the person, never as root: `homingbird service install --server <url> --agent <preset or command>`.

**Signing in is never pre-provisioned.** Credentials are per person, so that the audit trail says who
drafted and offboarding revokes one person's access. Do not create credential files centrally or copy
one person's credential to another's machine; a person may move their own to a server they run, as in
[A complete example: one person's runner on a Linux server](#a-complete-example-one-persons-runner-on-a-linux-server). After the script, each person runs `homingbird login --server <url>` once and
approves the connection in the browser; until then the service runs and waits, and `homingbird service
status` says `Sign in first: homingbird login --server <url>`. Put that line in your onboarding
instructions too: **My agent**, **Connection** in the web client shows the same command while none of
the person's agents is connected, but the server cannot tell a waiting service from no service at
all, and sends no notification.

**Tested so far.** The service definitions are generated by tested code. On macOS the launchd agent
was installed and run on a real Mac by the maintainer for 0.1.3, and CI installs the real launchd
agent on macOS and the Run key entry on Windows on every change, has each answer a note, then removes
them (`scripts/service-smoke.ts`). The MDM scripts below have not been run by an MDM yet, Windows has not
been used on a real machine, and on Linux the systemd unit is checked with `systemd-analyze verify` but
has not been loaded by a real user manager. Try each script on one machine before rolling it out.

The examples use `--agent claude`; `homingbird presets` lists the others, and a full command works
too. Add `--split` to keep the drafting agent away from a note's wording (see the guide).

### macOS (Jamf or another MDM, run as root)

MDM scripts run as root, and the service must belong to the person, so the script installs the CLI for
the machine and then registers the service as the user at the console, in their own login session.

```sh
#!/bin/sh
set -eu
SERVER="https://homingbird.example.com"
AGENT="claude"

npm install -g @homingbird/cli

user=$(stat -f%Su /dev/console)
if [ "$user" = "root" ] || [ "$user" = "loginwindow" ]; then
  echo "Nobody is logged in; run this again at the next login." >&2
  exit 0
fi
uid=$(id -u "$user")
launchctl asuser "$uid" sudo -u "$user" -i \
  homingbird service install --server "$SERVER" --agent "$AGENT"
```

The service keeps the `PATH` it was installed with, here that of the person's login shell from
`sudo -i`. That `PATH` may not hold the agent: tools installed through a version manager or a shell
profile such as `.zshrc` are often missing from it. When in doubt, pass the agent by its absolute path,
such as `AGENT="/opt/homebrew/bin/claude -p"`, and check the result with `homingbird service status`
and the log. The service is a launchd agent in `~/Library/LaunchAgents`, loaded into `gui/<uid>`.

### Windows (Intune, run as the signed-in user)

In Intune, add it as a PowerShell script with **Run this script using the logged on credentials** set
to **Yes**: the entry belongs to the person and runs with their rights. `service install` refuses to
run as SYSTEM or a machine account. Untested on a real Windows machine.

```powershell
$ErrorActionPreference = 'Stop'
$Server = 'https://homingbird.example.com'
$Agent = 'claude'

npm install -g @homingbird/cli
& "$env:APPDATA\npm\homingbird.cmd" service install --server $Server --agent $Agent
```

`service install` writes a value under the person's own Run key
(`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), which Windows starts at their logon, and
starts the runner at once. The runner supervises itself: it starts again detached and hidden, so a
console window flashes briefly at logon, keeps one copy per server, retries what fails and writes its
own log. `service uninstall` deletes the value and asks the runner to stop. The agent command cannot
contain `"` or `%` on Windows, and `service install` refuses a command line longer than the 32,767
characters Windows starts. At logon `PATH` may not yet hold where the agents' own installers put them,
so the runner also looks in `%USERPROFILE%\.local\bin` (Claude Code),
`%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` (Codex), `%LOCALAPPDATA%\agy\bin` (Antigravity) and
`%APPDATA%\npm`. Agent commands run through `cmd.exe /d /v:off /s /c`, so a `!` stays as written; a
`%NAME%` in one is still replaced by that variable. File modes such as `0600` mean nothing on Windows:
the agent credential is kept private by the access rules of the person's own profile folder. None of
this has been run on Windows yet.

### Linux (onboarding script, or configuration management)

Run by the person, the script is two commands:

```sh
#!/bin/sh
set -eu
SERVER="https://homingbird.example.com"
AGENT="claude"

npm install -g @homingbird/cli   # or set an npm prefix in the person's home first
homingbird service install --server "$SERVER" --agent "$AGENT"
```

From configuration management running as root, install the CLI as above and register the service as
the person, inside their running login session, which systemd user services need:

```sh
user="june"
uid=$(id -u "$user")
sudo -iu "$user" env XDG_RUNTIME_DIR="/run/user/$uid" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" \
  homingbird service install --server "$SERVER" --agent "$AGENT"
```

The unit is `~/.config/systemd/user/homingbird-runner-<server>.service`, enabled for
`default.target`: it starts when the person logs in and stops when they log out.

### Headless agents: what to expect

- **One runner per person and server on a computer.** A second `homingbird run` for the same person
  waits while the first holds the desk, and a second copy of the service exits; neither drafts twice.
- **The service log says why an agent run failed** in one line: the exit code and the first line the
  agent wrote to its error output, at most 160 characters, with the agent credential and the
  credentials file's path withheld. Nothing else the agent writes reaches the log.
- **Antigravity needs a sign-in it can reuse.** The runner asks `agy -p /usage` first and stops,
  before any note waits, when agy does not answer within 20 seconds or is not signed in; sign in by
  running `agy` once in a terminal as the same user. agy is reported to ignore a sign-in made on the
  machine itself when `SSH_CONNECTION` is set, so a runner started over SSH may see it as signed out:
  sign in inside that SSH session, or start the runner from a local login or the service. This has
  not been checked with the real CLI. The runner switches agy's own updater off for its runs
  (`AGY_CLI_DISABLE_AUTO_UPDATE=true`), so an update never takes a console or the focus.
- **A tool the agent may not use is denied, never waited for.** Claude Code runs with
  `--permission-prompts none`. Antigravity denies such a tool and still exits successfully; the runner
  then logs the first line agy wrote about it beside the draft.

### What people do afterwards

- `homingbird login --server <url>` once, approving the connection in the browser.
- `homingbird service status` to see whether it is running and where its log is;
  `homingbird desk pause` and `homingbird desk resume` to pause their desk on that computer.
- To offboard, revoke the person's credentials in Dovecote (see [When someone leaves](#when-someone-leaves));
  their service then waits for a sign-in that never comes. `homingbird service uninstall` removes it.

## Configuration

Every variable Dovecote reads. Blank values count as unset.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HB_PUBLIC_URL` | required | The URL people and agents use, such as `https://homingbird.example.com` |
| `HB_PORT` | `8080` | Port to listen on |
| `HB_DATABASE_URL` | `sqlite:./data/dovecote.sqlite`; `sqlite:/data/dovecote.sqlite` in the image | `sqlite:`, `postgres:`, `postgresql:` or `mysql:` (MySQL is experimental: tested automatically, not yet used in a real deployment) |
| `HB_OIDC_ISSUER` | `https://accounts.google.com` | Any OpenID Connect issuer. Its discovery document must name exactly this issuer, and its endpoints must be public https hosts; otherwise sign-in is unavailable and says why |
| `HB_OIDC_CLIENT_ID`, `HB_OIDC_CLIENT_SECRET` | required | From your identity provider. The redirect URI is `<HB_PUBLIC_URL>/auth/callback` |
| `HB_OIDC_LABEL` | `Google` | Name on the sign-in button, at most 40 characters |
| `HB_ADMIN_EMAILS` | required | Administrators, comma-separated. Nobody becomes one implicitly, except with `HB_DEV_LOGIN=1`: there it is optional, and while it is unset the first member to sign in becomes an administrator (the startup warning says so) |
| `HB_ALLOWED_DOMAINS` | none | Email domains allowed to sign in, comma-separated. A starting value: administrators change it in the web client |
| `HB_CONTACT_MODE` | `open` | `open`, or `contacts` to require an accepted request before messaging. A starting value, like the one above |
| `HB_CHANNELS` | none | Channels created on start, `slug` or `slug: description`, comma-separated. Exactly these are created, once, and nobody is joined to them |
| `HB_SESSION_DAYS` | `30` | Days a sign-in lasts before the identity provider is asked again |
| `HB_AGENT_CREDENTIAL_DAYS` | `90` | Days an agent credential lasts |
| `HB_FEATURES` | all on | Starting feature switches, `name=on` or `name=off`, comma-separated ([Features](#features)). A starting value, like `HB_ALLOWED_DOMAINS` |
| `HB_QUICK_APPROVAL_SECONDS` | `3` | A draft sent as written within this many seconds of appearing counts as a quick approval ([Insights](#insights)) |
| `HB_INSIGHTS_MINIMUM_GROUP` | `1` | The smallest group whose numbers Insights shows; 1 hides nothing ([Insights](#insights)) |
| `HB_TRUST_PROXY` | `0` | Number of proxies in front that append to `X-Forwarded-For`; see [above](#behind-a-load-balancer) |
| `HB_LOGS` | `audit=full,operational=info,requests=off,auditCopy=off` | What is recorded ([Logs](#logs)). The operator's only |
| `HB_AUDIT_RETENTION_DAYS` | `400` | Days to keep audit rows, at least 90 |
| `HB_AUDIT_STDOUT` | `0` | `1` means `HB_LOGS=auditCopy=on` |
| `HB_ANALYTICS`, `HB_ANALYTICS_URL`, `HB_ANALYTICS_KEY` | `off` | Where product analytics go ([Product analytics](#product-analytics)) |
| `HB_PUSH_HOSTS` | the four push services above | Push service hosts subscriptions may use |
| `HB_SECRETS_KEY` | none | 32 random bytes in base64 that seal cloud desk wakes; the cloud desk is offered only with it ([Cloud desk](#cloud-desk)) |
| `HB_WAKE_HOSTS` | `api.anthropic.com` | Hosts a cloud desk's wake address may use, matched exactly; `none` for none |
| `HB_OAUTH_REDIRECT_HOSTS` | `claude.ai,claude.com` | Hosts, besides loopback, that OAuth clients may redirect to; `none` for no others |
| `HB_OAUTH_CLIENT_METADATA_HOSTS` | `claude.ai,claude.com` | Hosts whose client metadata documents are fetched; `none` to fetch none |
| `HB_OAUTH_CLIENTS` | none | Preregistered clients, `id\|Name\|redirect;redirect`, comma-separated |
| `HB_WEB_DIR` | `/app/web` in the image | Directory of the web client to serve |
| `HB_THEME_DIR` | none | A directory with `theme.css`, `branding.json`, and the fonts and images they use, served under `/theme/` ([guide](guide.md#bring-your-own-web-client)) |
| `HB_DEV_LOGIN` | `0` | `1` lets anyone sign in as anyone without an identity provider. Refused unless `HB_PUBLIC_URL` is a loopback address. With `HB_ALLOWED_DOMAINS` unset it accepts any address |

### Trying it on one computer

Development login needs no identity provider and lets anyone who reaches the server sign in as anyone,
so bind it to `127.0.0.1`:

```sh
docker run -p 127.0.0.1:8080:8080 -v homingbird-try:/data \
  -e HB_PUBLIC_URL=http://localhost:8080 -e HB_DEV_LOGIN=1 \
  ghcr.io/let-sunny/homingbird
```

With `HB_ALLOWED_DOMAINS` unset, development login accepts any address and the server prints a warning
when it starts; set it to limit sign-in to some domains even here.
With `HB_ADMIN_EMAILS` unset, the first member to sign in becomes an administrator, and the warning says
so too. This happens only with development login; a production server refuses to start without
`HB_ADMIN_EMAILS`.

## Ready-made setups

- **Docker Compose:** `docker-compose.yml` at the repository root runs Dovecote on SQLite in a volume,
  with an optional `postgres` profile.
- **Terraform for GCP and AWS:** Experimental: tested automatically, not yet used in a real deployment.
- **Google Cloud:** [`deploy/terraform/gcp`](../deploy/terraform/gcp/README.md): Cloud Run with one
  instance, Cloud SQL for PostgreSQL, and an HTTPS load balancer. It sets `HB_TRUST_PROXY=2`, because
  that load balancer appends the client address and then its own.
- **AWS:** [`deploy/terraform/aws`](../deploy/terraform/aws/README.md): ECS Fargate with one task, RDS for
  PostgreSQL, and an Application Load Balancer. It sets `HB_TRUST_PROXY=1`, because that load balancer
  appends only the client address.

Both Terraform setups pass `terraform validate` in CI; neither has been planned or applied against a
real project. Each README says what to check.
