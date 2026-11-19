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

- [Measurements](#measurements)
- [One instance only](#one-instance-only)
- [Choosing a database](#choosing-a-database)
- [Behind a load balancer](#behind-a-load-balancer)
- [Backups](#backups)
- [When someone leaves](#when-someone-leaves)
- [Audit log forwarding](#audit-log-forwarding)
- [Answering flow](#answering-flow)
- [Insights](#insights)
- [Features](#features)
- [Web push](#web-push)
- [Connecting claude.ai](#connecting-claudeai)
- [Running the desk runner on a server](#running-the-desk-runner-on-a-server)
- [Roll out to an organization](#roll-out-to-an-organization)
- [Configuration](#configuration)
- [Ready-made setups](#ready-made-setups)

**Experimental parts.** Experimental: tested automatically, not yet used in a real deployment. This applies to the A2A gateway (`/a2a`), the Terraform configurations
for GCP and AWS, and MySQL support.

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
  links a posted debate result to its room; a database at step 2 gets it on its next start.
- The mechanism for later changes exists: a `schema_versions` table records which schema steps a
  database has, and Dovecote applies the missing ones in order when it starts, each in its own
  transaction. There are no down-migrations.
- Dovecote refuses to start on a database it did not make: one that records a version this build does
  not know, or that holds its tables with no version recorded. It says so in one sentence and changes
  nothing. A database from a 0.1.0 release candidate is such a database: recreate it, starting from an
  empty one.
- A server rolled back to an older version refuses a database a newer one migrated, because it records
  a step that version does not know. Back up before upgrading, and restore that backup to roll back.
- Upgrades between 0.x releases are not promised. [Back up](#backups) before every upgrade, and read
  the [changelog](../CHANGELOG.md) first.

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
- **PostgreSQL and MySQL:** use the managed service's automated backups with point-in-time recovery.
  Both Terraform setups turn them on.
- The database holds note content, the audit log and hashed credentials. Encrypt backups and restrict
  who can read them.

## When someone leaves

**Deactivate the member in Homingbird; blocking their company account is not enough.** An
administrator opens **Administration**, **Members** in the web client and presses **Deactivate**
(the API route `admin.members.update` with `status: deactivated`). At once:

- every credential of that member is revoked: browser sessions and agent credentials. Their next
  request is refused, and an open event stream ends at its
  next heartbeat, within 20 seconds;
- they disappear from the directory, and nobody can address a new note to them;
- signing in again is refused, even while their company account still works.

**Reactivate** in the same place lets them sign in again; their agents must sign in again too,
because revoked credentials stay revoked. The deactivation itself is audited.

What stays: notes they sent remain in their conversations for the other participants, and the audit
log keeps every entry about them, note content included, until `HB_AUDIT_RETENTION_DAYS` removes it
(by default never). Their unsent drafts stay in the database and no one else can see them.

Limits:

- Nothing syncs with the identity provider. There is no SCIM ([roadmap](roadmap.md#operations)), so
  deactivation is a manual step in your offboarding.
- Blocking the company account alone stops new sign-ins, but credentials already issued keep working
  until they expire: a browser session after `HB_SESSION_DAYS` (30 days by default), an agent
  credential after `HB_AGENT_CREDENTIAL_DAYS` (90 days by default). Refreshing an
  agent's token does not extend that.

## Audit log forwarding

Every state-changing call and every sign-in is audited in the same transaction as the action, with the
note content. Administrators read the log in the web client. To keep it elsewhere as well:

- **`HB_AUDIT_STDOUT=1`** prints each entry as one JSON line on stdout. Cloud Logging and CloudWatch Logs
  collect it with no further setup.
- **`HB_AUDIT_WEBHOOK_URL=https://...`** posts entries in batches to your endpoint, retrying with backoff,
  and logs loudly when it gives up.
- **`HB_AUDIT_RETENTION_DAYS`** sets how long Dovecote itself keeps entries; by default, forever.

Both forwards are off by default because the entries contain note content. Point them only at systems
cleared for it.

**Private channels are private from other members, not from the organization.** A private channel is
hidden from everyone outside it in the web client, the API and every agent tool, but the audit log
records the content of its notes like any other, administrators can manage every channel, and anyone
who can read the database or the forwarded entries can read it. Tell your members so; the user guide
says it too. Every change to a channel's members, managers and visibility is audited as well.

## Answering flow

An administrator can set one answering flow for the server: steps every member's desk follows before
drafting, and checks it runs on each draft before a person sees it. Set it as `answeringFlow` on
`PUT /api/v1/admin/settings` with an administrator's session, or in the web client's administration
settings, where the steps are two lists, each step with a switch to turn it off, edited in place and
put in order; the change is audited with its text. A turned off step is stored with "[off] " in front and
never reaches an agent. Write each step by the outcome you want, not by a tool, because members' agents differ
in what they have; the [guide](guide.md#answering-flow) shows the format. The flow is not shown to
members but reaches each member's agent, so never put confidential material in it.

## Insights

Every member sees their own agent's numbers under **My agent** ([guide](guide.md#see-how-far-you-can-trust-your-agent)):
how many of its drafts were sent as written, edited or discarded, what it skipped, and how quickly the
member decided. Administrators see **Insights** in the administration area: people who sent notes,
notes per person, reply rate and typical time to the first reply, the approval mix, the share of quick
approvals and of skipped notes, and totals per channel. Insights hold numbers only, never note content
and never one person's figures:

- A period in which fewer than `HB_INSIGHTS_MINIMUM_GROUP` people (5 by default) sent notes shows no
  numbers at all, and the block count is shown only as a number, and only once the organization has
  that many members.
- A channel, or direct messages together, appears on its own only when at least that many people
  contributed to it. When the left-out groups together would still be fewer people, the next smallest
  group is left out too, so the organization's totals minus the shown groups never reveal a small one.
- The member's own route is for people only: an agent credential cannot read how its person approves.

Principles that members teach their agents ([guide](guide.md#my-agent)) are private to each member and
never appear in Insights. Like every action and every note, they are recorded in full in the audit log.

Two settings shape the numbers. Both apply to everything already recorded, because Dovecote stores
times, not verdicts:

- `HB_QUICK_APPROVAL_SECONDS` (default `3`): a draft sent as written within this many seconds of first
  appearing on its person's screen counts as a quick approval.
- `HB_INSIGHTS_MINIMUM_GROUP` (default `5`): the smallest group whose numbers are shown. It can be
  raised, never set below 5.

The figures are computed when the page is opened, from the last 60 days of notes, decisions and skips.
Teams are not built yet, so only organization-wide numbers are shown.

## Features

An administrator can turn optional features off under **Administration → Settings → Features**. A
feature that is off disappears from the web client, its routes answer 404 "This feature is turned off in
this organization.", agents are told nothing about it, and its data is kept for when it is turned on
again. Every change is audited. `server.info` lists which features are on, so every client adapts.

| Switch | Default | When it is off |
| --- | --- | --- |
| `channels` | on | People can no longer create channels; existing channels stay |
| `draftRequests` | on | People can no longer ask their agent for a draft from the web client |
| `characters` | on | Everyone shows as the pigeon; nobody can change a character |
| `webPush` | on | No notifications reach phones or computers |
| `answeringFlow` | on | Agents draft without the organization's steps |
| `teaching` | on | Principles are kept but not used, and nobody can add one (the route map goes too) |
| `agentFigures` | on | People no longer see their agent's figures |
| `routeMap` | on | My agent shows no route map |
| `insights` | on | Administrators see no organization-wide numbers |
| `noteDetails` | on | Notes no longer show the model and program that wrote them |
| `debateRooms` | on | Debate rooms are hidden, agents take no turns and no room stops on time; the rooms stay |

Notes, drafts, approval, direct messages, sign-in and the audit log are the core and cannot be turned
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

## Roll out to an organization

Install the command line and register each person's runner centrally, with MDM (Jamf, Intune) or an
onboarding script, so that people only open the web client. Every script does two things:

1. Install the CLI: `npm install -g @homingbird/cli` (Node 22 or newer must already be installed).
2. As the person, never as root: `homingbird service install --server <url> --agent <preset or command>`.

**Signing in is never pre-provisioned.** Credentials are per person, so that the audit log says who
drafted and offboarding revokes one person's access. Do not copy credential files between machines or
create them centrally. After the script, each person runs `homingbird login --server <url>` once and
approves the connection in the browser; until then the service runs and waits, and `homingbird service
status` says `Sign in first: homingbird login --server <url>`. Put that line in your onboarding
instructions: the service does not yet tell the person through the web client or a notification.

**Tested so far.** The service definitions are generated by tested code, but on macOS and Windows
neither they nor the scripts below have been run on those systems yet, and on Linux the systemd unit
is checked with `systemd-analyze verify` but has not been loaded by a real user manager. Try each
script on one machine before rolling it out. Windows is untested.

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
contain `"` or `%` on Windows. None of this has been run on Windows yet.

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
| `HB_INSIGHTS_MINIMUM_GROUP` | `5` | The smallest group whose numbers Insights shows; at least 5 ([Insights](#insights)) |
| `HB_TRUST_PROXY` | `0` | Number of proxies in front that append to `X-Forwarded-For`; see [above](#behind-a-load-balancer) |
| `HB_AUDIT_STDOUT` | `0` | `1` prints audit entries as JSON lines |
| `HB_AUDIT_WEBHOOK_URL` | none | Posts audit entries to this URL |
| `HB_AUDIT_RETENTION_DAYS` | keep forever | Days to keep audit entries. A starting value, like `HB_ALLOWED_DOMAINS` |
| `HB_PUSH_HOSTS` | the four push services above | Push service hosts subscriptions may use |
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
