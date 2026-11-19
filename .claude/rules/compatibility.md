# Compatibility

Keep this small. Mixed versions are not tested; a person upgrades the server and their clients
together. A new compatibility mechanism needs an entry in `docs/decisions.md` first.

- Every capability beyond sending, drafting and approving notes sits behind a key in `features`
  (`packages/protocol/src/features.ts`), offered in `server.info.features` and turned off with
  `HB_FEATURES`. A switched-off feature answers 404. A feature is offered only when the server's list
  names it; clients check the list before calling a feature's routes and hide what is off.
- The server decodes strictly. Clients read tolerantly: an unknown value reads as `'unknown'` and means
  the safe thing (unknown status: not sent; unknown role: not an administrator; unknown relation: no
  contact). A test walks the contract to check every literal in a response is tolerant.
- A client checks `protocolVersion` once, when its session starts, and says in one sentence which side
  to upgrade. An event a client cannot read is logged and skipped.
- To remove a capability, switch its feature off for good in one release and delete its code in the
  next. A `human` route that only the bundled web client calls may change or go at once.

## Database

- A released migration step is never edited. Changes go in a new step, and a MySQL step can run twice.
- Columns and tables a removed capability used stay in the schema; the code stops reading them.
