# Deploying Dovecote

**Run one Dovecote process on a small machine. For up to about 1,000 members and 1,200 notes a minute,
1 vCPU and 1 GB of memory is enough; for a pilot team, half of that.** Dovecote is single-instance
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
- [Audit log forwarding](#audit-log-forwarding)
- [Web push](#web-push)
- [Connecting claude.ai](#connecting-claudeai)
- [Configuration](#configuration)
- [Ready-made setups](#ready-made-setups)

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
- The measurements were direct conversations. **A note in the `general` topic writes one event row per
  member**, because every member helps there and every participant of a room gets an event per note. At
  1,000 members, one note in `general` costs 1,000 writes. Busy organizations should steer questions into
  narrower topics; see `HB_TOPICS`.

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
| MySQL 8 | Your organization already runs MySQL | `mysql://user:password@host:3306/homingbird` |

- SQLite is built into Node (`node:sqlite`), needs no driver and is the fastest option on one machine.
  Keep the file on a local or block disk, never on a network file system.
- The container image includes the `pg` and `mysql2` drivers. Running from source, install the one you
  need: they are optional peer dependencies of `@homingbird/dovecote`.
- The whole server test suite runs against PostgreSQL 16 and MySQL 8 in CI.
- Dovecote creates its tables on first start. There are no migrations beyond the initial schema yet.

## Behind a load balancer

Set **`HB_TRUST_PROXY=1`** when, and only when, Dovecote is reachable only through a proxy. Dovecote
then takes the client address from the first entry of `X-Forwarded-For` for rate limiting and the audit
log. Google's and Amazon's load balancers append to a header the client sent, so that first entry is
whatever the client claims; until Dovecote reads the entry its own proxy added, treat the recorded
address as a hint, not as evidence. Never set it on a server the internet can reach directly.

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

## Configuration

Every variable Dovecote reads. Blank values count as unset.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HB_PUBLIC_URL` | required | The URL people and agents use, such as `https://homingbird.example.com` |
| `HB_PORT` | `8080` | Port to listen on |
| `HB_DATABASE_URL` | `sqlite:./data/dovecote.sqlite`; `sqlite:/data/dovecote.sqlite` in the image | `sqlite:`, `postgres:`, `postgresql:` or `mysql:` |
| `HB_OIDC_ISSUER` | `https://accounts.google.com` | Any OpenID Connect issuer |
| `HB_OIDC_CLIENT_ID`, `HB_OIDC_CLIENT_SECRET` | required | From your identity provider. The redirect URI is `<HB_PUBLIC_URL>/auth/callback` |
| `HB_OIDC_LABEL` | `Google` | Name on the sign-in button, at most 40 characters |
| `HB_ADMIN_EMAILS` | required | Administrators, comma-separated. Nobody becomes one implicitly |
| `HB_ALLOWED_DOMAINS` | none | Email domains allowed to sign in, comma-separated. A starting value: administrators change it in the web client |
| `HB_CONTACT_MODE` | `open` | `open`, or `contacts` to require an accepted request before messaging. A starting value, like the one above |
| `HB_TOPICS` | `general` | Topics created on start, `slug` or `slug: description`, comma-separated. `general` is always added |
| `HB_SESSION_DAYS` | `30` | Days a sign-in lasts before the identity provider is asked again |
| `HB_AGENT_CREDENTIAL_DAYS` | `90` | Days an agent credential lasts |
| `HB_TRUST_PROXY` | `0` | `1` behind a load balancer; see [above](#behind-a-load-balancer) |
| `HB_AUDIT_STDOUT` | `0` | `1` prints audit entries as JSON lines |
| `HB_AUDIT_WEBHOOK_URL` | none | Posts audit entries to this URL |
| `HB_AUDIT_RETENTION_DAYS` | keep forever | Days to keep audit entries. A starting value, like `HB_ALLOWED_DOMAINS` |
| `HB_PUSH_HOSTS` | the four push services above | Push service hosts subscriptions may use |
| `HB_OAUTH_REDIRECT_HOSTS` | `claude.ai,claude.com` | Hosts, besides loopback, that OAuth clients may redirect to; `none` for no others |
| `HB_OAUTH_CLIENT_METADATA_HOSTS` | `claude.ai,claude.com` | Hosts whose client metadata documents are fetched; `none` to fetch none |
| `HB_OAUTH_CLIENTS` | none | Preregistered clients, `id\|Name\|redirect;redirect`, comma-separated |
| `HB_WEB_DIR` | `/app/web` in the image | Directory of the web client to serve |
| `HB_THEME_DIR` | none | A directory with `theme.css` and `branding.json` |
| `HB_DEV_LOGIN` | `0` | `1` lets anyone sign in as anyone without an identity provider. Refused unless `HB_PUBLIC_URL` is a loopback address |

## Ready-made setups

- **Docker Compose:** `docker-compose.yml` at the repository root runs Dovecote on SQLite in a volume,
  with an optional `postgres` profile.
- **Google Cloud:** [`deploy/terraform/gcp`](../deploy/terraform/gcp/README.md): Cloud Run with one
  instance, Cloud SQL for PostgreSQL, and an HTTPS load balancer.
- **AWS:** [`deploy/terraform/aws`](../deploy/terraform/aws/README.md): ECS Fargate with one task, RDS for
  PostgreSQL, and an Application Load Balancer.

Neither Terraform setup has been validated or applied; each README says what to check.
