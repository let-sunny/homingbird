# Dovecote on AWS

**Experimental: tested automatically, not yet used in a real deployment.**

**This configuration passes `terraform fmt` and `terraform validate` in CI; it has never been planned
or applied against a real project.** Treat it as a starting point: run `terraform init` and
`terraform plan`, and read the plan before applying anything.

It creates one ECS Fargate service running exactly one Dovecote task behind an Application Load
Balancer, an RDS for PostgreSQL database, and two Secrets Manager secrets (the OpenID Connect client
secret and the database URL). It deploys into a VPC you already have.

```sh
terraform init
terraform apply \
  -var image=123456789012.dkr.ecr.us-east-1.amazonaws.com/dovecote:0.1.0 \
  -var public_url=https://homingbird.example.com \
  -var certificate_arn=arn:aws:acm:us-east-1:123456789012:certificate/... \
  -var vpc_id=vpc-... \
  -var 'public_subnet_ids=["subnet-a","subnet-b"]' \
  -var 'private_subnet_ids=["subnet-c","subnet-d"]' \
  -var oidc_client_id=... \
  -var oidc_client_secret=... \
  -var 'allowed_domains=["example.com"]' \
  -var 'admin_emails=["june@example.com"]' \
  -var 'channels=["billing: Invoices and the nightly export", "deploys"]'
```

Every variable Dovecote reads is either a variable here (`channels`, `contact_mode`, `audit_webhook_url`,
`audit_retention_days`) or can be passed through `extra_environment`, for example
`-var 'extra_environment={HB_SESSION_DAYS="14"}'`. See [docs/deployment.md](../../../docs/deployment.md#configuration).

## What it decides for you

- **One task, always.** `desired_count` is 1 and a deployment stops the old task before starting the new
  one (`minimum 0%`, `maximum 100%`), so two tasks never serve at once. Dovecote delivers live events
  inside one process; a second task would silently miss the first one's notes. Do not add autoscaling.
  See [docs/deployment.md](../../../docs/deployment.md#one-instance-only). A deployment therefore means a
  short outage, after which clients reconnect and resume from their last sequence number.
- **Load balancer idle timeout of 3600 seconds.** Dovecote sends a heartbeat every 20 seconds, so the
  default of 60 would also hold; the higher value leaves room for a proxy in front that buffers them.
- **`HB_TRUST_PROXY=1`**, because the task is reachable only through the load balancer, and the
  Application Load Balancer appends one entry, the client address it saw, to `X-Forwarded-For`. See
  [docs/deployment.md](../../../docs/deployment.md#behind-a-load-balancer).
- **`HB_AUDIT_STDOUT=1`**, so the audit trail reaches CloudWatch Logs.

## What it leaves to you

- Building the image (`docker build -t ... .` at the repository root) and pushing it to ECR.
- The VPC, its subnets and a NAT gateway: the task needs outbound HTTPS to reach the identity provider,
  push services and the audit webhook.
- The ACM certificate, the DNS record pointing at the load balancer, and registering
  `<public_url>/auth/callback` with your identity provider.
- Remote state. The state holds the database password and the client secret in plain text; keep it in a
  bucket with restricted access.

## Unverified details to check in the plan

- The database URL carries no `sslmode`. Recent RDS PostgreSQL parameter groups set `rds.force_ssl=1`,
  which rejects such a connection; either append `?sslmode=require` (and confirm the `pg` driver accepts
  the RDS certificate chain) or use a parameter group that allows it. This has not been tried.
- Provider `hashicorp/aws` is pinned to `~> 5.0`; argument names were written from memory of that
  version's documentation.
