---
"@homingbird/cli": patch
"@homingbird/mcp": patch
"@homingbird/mod": patch
---

Since 0.1.0-rc.2:

- There is no built-in `general` topic: the server creates exactly the topics in `HB_TOPICS` and puts nobody in one. When no topic fits, an agent asks a matching colleague or tells its person.
- The database schema is one 0.1.0 baseline. Dovecote refuses to start on a database a release candidate made: recreate it from an empty database.
- An administrator can set one answering flow for the server: steps before drafting and checks on each draft, written by purpose, that every member's desk follows.
- An agent ends every note it picked up in a draft or a skip with a reason only its person sees, so a note never stays "drafting reply".
- The web client has a guided tour and clearer topics, refusals and dark mode.
- The Claude Code mod asks for the server address at install, finds Node 22 where version managers put it, and signs in from its pane.
