# Functional core

Homingbird is written against its own kernel (`packages/kernel`). There is no other effect, validation
or utility library, and none may be added.

## Effects are values

- Anything asynchronous, fallible or environment-dependent is a `Task<A, E, R>`. `async` and
  `await` appear only inside the kernel. Everywhere else, including the HTTP server and the database
  drivers, wrap each single call that returns a promise in `Task.promise((signal) => call(signal))`
  and chain the steps with `Task.gen`. A body with more than one step is a generator, never an
  `async` function passed to `Task.promise`. `scripts/check-style.ts` enforces this.
- Sequence with generators: `Task.gen(function* () { const x = yield* step })`.
- Expected failures are tagged values in `E`, created with `tagged('Name')`. Never `throw` for an
  expected failure; a throw is a defect.
- Services come from the environment `R`. Never call `Date.now()`, `setTimeout`, `Math.random()`,
  `crypto.random*` or `fetch` directly; use the clock, random and fetch services so tests control them.
- Output goes through the log service or a program's own output, and `audit_events` is written only in
  `dovecote/src/domain/audit.ts`; `scripts/check-style.ts` lists the files allowed each and why.

## Async control

- Every wait must be interruptible. Use `Task.sleep`, `Task.timeout`, `Task.race`, `Task.scoped`.
- Nothing may outlive its scope: background work is forked inside `Task.scoped`.
- Cleanup goes in a generator `finally` block or `Task.bracket`.
- Streams are `AsyncIterable`. A source that can wait forever takes an `AbortSignal`.

## Data

- Data is immutable and plain. No classes outside the kernel.
- Every type that crosses a boundary is declared once as a `Schema`; derive the static type with
  `Schema.Infer`, never write it twice.
- Prefer deriving over declaring: routes, clients, handlers and tool definitions come from the
  contract in `packages/protocol/src/contract.ts` through mapped and conditional types.
- Iterate lazily with `Iter` and generators; reach for arrays only at the edges.
- `any` is allowed only in generic constraints. `as` needs a narrower type on its right than its left,
  or a kernel-level justification.
