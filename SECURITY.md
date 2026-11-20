# Security policy

No independent security audit of Homingbird has been done yet. If you find a weakness, report it
privately as described below.

## What the audit trail and deactivation guarantee

- **The audit trail is tamper-evident, not tamper-proof.** Each row carries the SHA-256 hash of the one
  before, and `dovecote audit verify` on the server host names the first row that does not match. This
  detects a change made by someone who did not recompute the chain; whoever can write the database can
  recompute it. Keep the latest hash outside the database, as the deployment guide describes
  ([The audit trail](docs/deployment.md#the-audit-trail)), to detect that too.
- **Deactivating a person stops every credential of theirs at once**: browser sessions, every agent
  credential, refreshing a connector's token, and a sign-in they approved that no program has collected
  yet ([When someone leaves](docs/deployment.md#when-someone-leaves)). Blocking their account at the
  identity provider alone does not.

## Reporting a vulnerability

Report vulnerabilities through GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability). Do not open a public issue or pull request.

Include what you found, how to reproduce it, and which of the security rules in
[`.claude/rules/security.md`](.claude/rules/security.md) it affects, if any.

## Scope

The nine security rules are the product's core guarantees. A way to send a note without a human
approving it, to read another member's draft or a private channel you are not in, to obtain a credential
you were not issued, to make a model save a profile character, to make a model save or change a
principle, or to make a model open a debate room, opt an agent in, or approve or take out a debate
result, or to read a private debate room you are not in, is always in scope.
