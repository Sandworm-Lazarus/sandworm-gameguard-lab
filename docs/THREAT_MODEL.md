# Threat model and limits

## Intended use

A developer supplies fabricated JSON events to compare two deterministic sequential state machines. No server, credential, production game, payment service, or network target is involved. This tool is educational regression evidence for business rules.

## Boundaries

Input is untrusted text. UTF-8 byte and collection limits bound accepted work. Exact schema keys, identifiers, numeric types, quantities, and safe integer arithmetic are validated. JSON parsing does not execute code. Errors use fixed messages and never include the original input or thrown parser cause. The interface renders data with textContent/DOM nodes, not HTML injection.

Each guarded event mutates a candidate copy, which replaces committed state only after checks pass. Successful normalized commands reserve idempotency keys in a per-run map. Caller-supplied actors are **not authentication**: a real server must derive identity from the authenticated session and use server-side authorization. This lab cannot protect external tools or server endpoints.

The baseline deliberately omits several business checks. All input still passes the shared schema; undefined references and unsafe purchase multiplication are rejected even in that baseline. Baseline invariants may fail by design.

## Privacy and output

The app has no fetch, WebSocket, storage, analytics, or external font service. A connect-src none CSP blocks application connection APIs. Source text remains in page memory until clear/reload/close. Browser extensions, compromised devices, screen capture, and browser-managed autofill/history are outside this protection boundary.

Export is explicit and requires review. JSON reports contain actor-associated account owner IDs, event keys, wallet balances, inventory, and shop state. Reports are not redacted; do not supply production secrets or personal data. Only a fixed filename is used for downloads. Imported filenames are not included in reports or error messages.

## Verification limits

- No concurrent requests, thread scheduling, database isolation/locking, persistence, crash recovery, distributed deduplication, or transport/session authentication is modeled.
- Passing a simulated case is not a security assessment of a real game or database.
- Native JSON parsing uses the final occurrence of a duplicate object key. Duplicate entity IDs are rejected separately.
- SHA-256 fingerprints detect differing bytes relative to the recorded digest. They are not digital signatures and do not prove code or fixture authenticity.
- Source hash is a build stamp verified by regression tests; browser users do not independently attest loaded engine code.
- Bounded input is not a comprehensive denial-of-service proof across every browser/device.
