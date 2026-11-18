# Dovecote on Google Cloud

**This configuration has never been validated, planned or applied, and was not run through
`terraform fmt`.** It was written by hand in an environment that could not reach the Terraform registry
and was not allowed to run a Terraform binary. Treat it as a starting point: run `terraform fmt`,
`terraform init`, `terraform validate` and `terraform plan`, and read the plan before applying anything.

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
  -var 'topics=["billing: Invoices and the nightly export", "deploys"]'
```

Every variable Dovecote reads is either a variable here (`topics`, `contact_mode`, `audit_webhook_url`,
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
- **`HB_TRUST_PROXY=1`**, because the service is reachable only through the load balancer.
- **`HB_AUDIT_STDOUT=1`**, so the audit trail reaches Cloud Logging.

## What it leaves to you

- Building the image (`docker build -t ... .` at the repository root) and pushing it to Artifact Registry.
- Pointing the domain's A record at the `load_balancer_address` output (the certificate is issued only
  once it resolves, which can take a while) and registering the `oidc_redirect_uri` output with your
  identity provider.
- Remote state. The state holds the database password and the client secret in plain text; keep it in a
  bucket with restricted access.

## Unverified details to check in the plan

- The database URL names the Cloud SQL Unix socket as `?host=/cloudsql/<connection name>`. The `pg`
  driver documents that form, but Dovecote has not been run against Cloud SQL this way.
- Provider `hashicorp/google` is pinned to `~> 6.0`; argument names were written from memory of that
  version's documentation.
