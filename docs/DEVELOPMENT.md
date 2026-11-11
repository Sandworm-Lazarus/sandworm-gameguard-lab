# Development record

## 0.1.0 — 2026-11-11

Original Sandworm implementation of a game-economy replay model and browser UI. Introduced six fabricated scenarios: duplicate transfer, ownership mismatch, insufficient funds, overselling, idempotency-key conflict, and excessive item use. The guarded model validates and atomically commits each event; the unchecked baseline exposes the effect of omitted rules.

The visual language follows the user's Sandworm Lazarus site: dark navy, coral headings, cyan/green evidence, angular buttons, original network artwork, and bundled Chakra Petch, Anuphan, and JetBrains Mono. No site scripts or unrelated private assets were copied.

Validation performed locally with Node.js 24.22.1: **26 tests passed**. `node scripts/run-fixtures.cjs` produced `docs/fixture-report.json`; all six scenarios preserved the guarded numerical invariants. These local results do not claim hosted GitHub Actions success or real-server security. Browser verification, if performed by the integrating owner, should be recorded separately with the viewport/runtime observed.

When changing the engine:

1. Implement a concrete behavior change with a regression case.
2. Run `npm run stamp` to regenerate the packaged engine SHA-256.
3. Run `npm run check` to validate and refresh `reports/validation.json`.
4. Regenerate the recorded fixture JSON using `node scripts/run-fixtures.cjs > docs/fixture-report.json`.
5. Compare event outcomes and state changes, rather than relying only on final invariant flags.

The engine intentionally models one process, one ordered event stream, and in-memory state. A future real API integration would require authenticated actor resolution, a database transaction model, persistent idempotency records, concurrency tests, and a separate threat assessment before making deployment claims.
