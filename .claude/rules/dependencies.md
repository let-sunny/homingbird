# Dependencies

Homingbird is small on purpose. A runtime dependency is a cost every self-hoster and every auditor
pays, so the default answer to "should we add a package" is no.

- **Runtime dependencies: none.** `kernel`, `protocol`, `client`, `ui`, `pwa`, `cli`, `mcp` and `a2a`
  ship with zero third-party runtime packages. Use the platform: `node:*` modules, `fetch`, Web Crypto,
  the DOM.
- **The only exception is a database driver.** `pg` and `mysql2` are optional peer dependencies of
  `dovecote`, loaded only when `HB_DATABASE_URL` names that database. SQLite uses `node:sqlite`.
- **Development dependencies are a short, fixed list:** TypeScript, Biome, Vitest, fast-check,
  Stryker, esbuild, tsx, Changesets. Adding one needs an entry in `docs/decisions.md` that says what it replaces.
- If the platform lacks something, write the smallest version that serves this project in the
  package that needs it, with tests. Protocols we implement ourselves (WebSocket framing, JSON-RPC,
  OAuth, OpenID Connect verification) are covered by tests against the specification's examples.
- Bundle size is a feature of the web client. Do not add a polyfill; use progressive enhancement.
