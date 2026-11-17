# Testing

- Every source file has a test file with the same name under the package's `test/` directory.
- `kernel` and `protocol` hold 100% statement, branch, function and line coverage and a mutation
  score of at least 90. Other packages hold the thresholds in `vitest.config.ts`. Never lower a
  threshold to make a change pass.
- Unreachable code is deleted, not excluded from coverage.
- Use property-based tests (`fast-check`) for anything with a law or an invariant: monad laws,
  round-trips, state machines, policy decisions. Derive generators from schemas with
  `arbitrary(schema)` from `@homingbird/kernel/testing`.
- No real time and no real network in unit tests. Use `makeTestClock()` and advance it; inject fakes
  through the task environment.
- A test name states the behaviour as a sentence: `it('refuses an agent credential that tries to send')`.
- Each security rule in `.claude/rules/security.md` has a dedicated test in
  `packages/dovecote/test/security-rules.test.ts`, named after the rule number. Changing behaviour
  covered by one of those tests needs a maintainer's explicit approval.
