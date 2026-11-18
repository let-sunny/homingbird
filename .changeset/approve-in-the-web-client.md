---
"@homingbird/cli": patch
"@homingbird/mcp": patch
"@homingbird/mod": patch
---

Approval is no longer available in the Claude Code mod: approve, edit and discard drafts in the web client, where you sign in yourself.

- The mod's pane shows each draft as "Waiting for your approval" with "Open in web", which opens its conversation in the web client. The pane no longer approves, edits or discards, and the approval credential it used is gone, together with the server setting, the `server.info` field and the device page checkbox that offered it. A credential that could approve, stored on the computer where the agent runs as the same user, could not be protected by the mod's pattern guard.
- The command line drops `homingbird approve`, `homingbird discard` and the login option that stored an approval credential; it stores an agent credential only. A device or OAuth sign-in issues nothing else, and Dovecote accepts a person's credential only from a browser sign-in, so approval credentials issued by 0.1.0-rc.3 stop working. An old `approval-credential.json` can be deleted.
- The person who approves sees what the draft is based on: the web client shows the agent's basis on the draft card, and says so when there is none. Only the draft's author ever receives it.
- "Your agent did not draft a reply" and a draft discarded because its channel was archived now survive a reload and show on every device.
- Administrators archive a channel with one action, "Archive channel", optionally moving its members to another channel; it replaces the two rc.3 actions and routes that removed a room or folded it into another (`admin.channels.archive` is the one route now).
- Agents show as "awake" rather than "online": connected is not the same as running.
- Sign-in checks the identity provider's discovery document: its issuer must equal `HB_OIDC_ISSUER`, its endpoints must be public https hosts, and discovery, keys and the token call refuse redirects. An ID token issued in the future, or not valid yet, is refused.
- After signing out and in again in one Claude Code session, the desk starts a fresh live stream for the new credential.
- The plugin marketplace now pins the exact mod version, so it installs the version the repository names instead of npm's `latest`.
- The A2A gateway, the Terraform configurations and MySQL support are marked experimental: tested automatically, not yet used in a real deployment.

Breaking: the rc.3 question rooms are now **channels** and one-to-one conversations **direct messages**, everywhere. Routes are `channels.*` and `admin.channels.*` under `/channels`, the conversation kinds are `channel` and `direct`, events are `channel.changed` and `channel.left`, drafts take `channel`, MCP and mod tools are renamed (for example `find_channels`), the command line takes `--channel` and `homingbird channels`, and the list of channels is set with `HB_CHANNELS`, which replaces the rc.3 `HB_TOPICS` (Dovecote refuses to start while `HB_TOPICS` is still set). Each channel explains itself in one sentence: ask there and the people who answer in it reply; every note is approved by a person first.

Also fixed after the rc.3 live test:

- Each server keeps its own agent credential (`~/.config/homingbird/agents/`, one private file per server address); the old shared `agent-credential.json` is ignored and removed at the next sign-in. Every command takes `--server` (or `HOMINGBIRD_SERVER`); without one it uses the only server signed in to and lists them when there are several. `logout` signs out of one server only, and `status` lists every server.
- The mod is bound to one server: every command it runs names it, it never shows another server's identity, the desk stops and says so when the account or server changes, and the pane has **Sign out**.
- The mod declares Claude Code 2.1.327 or newer; on an older Claude Code the pane still loads and says to update.
- Push notifications: a person counts as looking only while a Homingbird page is visible, so a minimised window or background tab gets notified; each push attempt is logged (member, push service host, answer); **Send a test notification** in the profile shows what each push service answered; the VAPID subject is an https address or a `mailto:`, never a plain http address; turning notifications on twice reuses the subscription.
- Development login without `HB_ALLOWED_DOMAINS` accepts any address, with a warning at start; the docs show a minimal local command bound to `127.0.0.1`.
- "Newer notes below" appears only for something unseen below and never covers a draft; the tour's callouts sit beside their controls; a conversation opened right after sign-in shows its notes.

A database created by 0.1.0-rc.3 does not keep working: the 0.1.0 baseline schema changed in place (still version 1). Start Dovecote with an empty database.
