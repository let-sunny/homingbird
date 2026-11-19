# Dovecote on Google Cloud

**Experimental: tested automatically, not yet used in a real deployment.**

**This configuration passes `terraform fmt` and `terraform validate` in CI; it has never been planned
or applied against a real project.** Treat it as a starting point: run `terraform init` and
`terraform plan`, and read the plan before applying anything.

It creates one Cloud Run service running exactly one Dovecote instance, a Cloud SQL for PostgreSQL
database, two Secret Manager secrets (the OpenID Connect client secret and the database URL), and a
global external HTTPS load balancer with a Google-managed certificate in front of the service. The
service accepts traffic only from the load balancer.

```sh
terraform init
terraform apply \
  -var project_id=my-project \
  -var image=us-docker.pkg.dev/my-project/homingbird/dovecote:0.1.0 \
  -var domain=homingbird.example.com \
  -var oidc_client_id=... \
  -var oidc_client_secret=... \
  -var 'allowed_domains=["example.com"]' \
  -var 'admin_emails=["june@example.com"]' \
  -var 'channels=["billing: Invoices and the nightly export", "deploys"]'
```

Every variable Dovecote reads is either a variable here (`channels`, `contact_mode`,
`audit_retention_days`) or can be passed through `extra_environment`, for example
`-var 'extra_environment={HB_SESSION_DAYS="14"}'`. See [docs/deployment.md](../../../docs/deployment.md#configuration).

## What it decides for you

- **One instance, always.** `min_instance_count` and `max_instance_count` are both 1. Dovecote delivers
  live events inside one process; a second instance would silently miss the first one's notes. Do not
  raise the maximum. See [docs/deployment.md](../../../docs/deployment.md#one-instance-only).
- **CPU always allocated.** Open event streams and timers need CPU between requests.
- **Request timeout of 3600 seconds**, the most Cloud Run allows. A stream is cut after an hour and the
  client reconnects from its last sequence number without losing events. A serverless backend ignores
  the load balancer's own backend timeout; the Cloud Run timeout is the one that applies.
- **`HB_TRUST_PROXY=2`**, because the service is reachable only through the load balancer and that load
  balancer appends two entries to `X-Forwarded-For`: the client address it saw, then its own address.
  Dovecote counts trusted entries from the right, so `2` picks the client address and ignores whatever
  the client put in the header itself. With `1` every request would appear to come from the load
  balancer, so rate limiting would lump all clients together and the audit trail would record Google's
  address. Add one if you put a CDN or another proxy in front. See
  [docs/deployment.md](../../../docs/deployment.md#behind-a-load-balancer).
- **`HB_LOGS=auditCopy=on`**, so a metadata-only copy of the audit trail reaches Cloud Logging next to the
  operational log, outside the database.

## What it leaves to you

- Building the image (`docker build -t ... .` at the repository root) and pushing it to Artifact Registry.
- Pointing the domain's A record at the `load_balancer_address` output (the certificate is issued only
  once it resolves, which can take a while) and registering the `oidc_redirect_uri` output with your
  identity provider.
- Remote state. The state holds the database password and the client secret in plain text; keep it in a
  bucket with restricted access.

## Unverified details to check in the plan

- The database URL names the Cloud SQL Unix socket as `?host=/cloudsql/<connection name>`. Dovecote's
  tests connect with exactly that URL shape through a local PostgreSQL socket, but it has not been run
  against Cloud SQL this way.
- The count of `2` follows Google's documentation of the external Application Load Balancer. After the
  first deployment, log `X-Forwarded-For` once from a known address and check that the client address is
  the second entry from the right.
- Provider `hashicorp/google` is pinned to `~> 6.0`; argument names were written from memory of that
  version's documentation.
