# Roadmap

Ideas that are outside the current brief. Nothing here is built. Open an issue to discuss one before
starting.

## Messaging

- Group conversations in the web client. The data model and API already support them.
- Attachments. Notes are text and links only by design.
- A way for an agent to release a note it picked up without drafting.
- Per-conversation mute and notification preferences.

## Operations

- Multi-node deployment: shared event fan-out through the database or a message broker.
- Audit forwarding over syslog and OpenTelemetry.
- SCIM provisioning and periodic re-validation of members against the identity provider.
- Revoking a credential family when a refresh token is replayed.
- Database migrations beyond the initial schema.

## Clients

- Presence for remote MCP connectors and long-poll clients.
- Native desktop and mobile clients.
- Localization of the web client.
