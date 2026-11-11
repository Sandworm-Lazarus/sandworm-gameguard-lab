# Scenario schema v1

The root object must contain exactly `version`, `accounts`, `shop`, `treasury`, and `events`. Native JSON parsing applies; duplicate object keys use their final value. Unknown schema properties are rejected. Keys shown below are case-sensitive.

```json
{
  "version": 1,
  "accounts": [
    {"id": "alice", "owner": "player-a", "balance": 100, "inventory": {"potion": 1}},
    {"id": "bob", "owner": "player-b", "balance": 25, "inventory": {}}
  ],
  "shop": [{"id": "potion", "price": 10, "stock": 2}],
  "treasury": 0,
  "events": [
    {"type": "transfer", "key": "t-1", "actor": "player-a", "from": "alice", "to": "bob", "amount": 30},
    {"type": "purchase", "key": "p-1", "actor": "player-a", "account": "alice", "item": "potion", "quantity": 1},
    {"type": "use", "key": "u-1", "actor": "player-a", "account": "alice", "item": "potion", "quantity": 1}
  ]
}
```

IDs, owners, actors, item names, and event keys match `[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}`. Each account ID and each shop ID must be unique. IDs do not need to identify a live game or real user.

Accounts: 1–100; shop items: 0–100; inventory entries per account: 0–100; events: 0–500. Every numeric value is a safe integer from 0 through 1,000,000,000. Prices, event amounts, and event quantities must be positive. The complete encoded input must be at most 262,144 UTF-8 bytes.

Missing account or shop references are event-level denials rather than whole-scenario schema errors. Transfer source and destination must differ. Buying deposits the price into treasury. Using consumes inventory without currency movement. Unknown inventory items cannot be consumed in the guarded model.

A successful idempotency key stores the normalized command, including actor and every operation parameter. Identical retries have no additional effect. Reusing a key for a different command rejects it. Failed commands do not reserve keys. Deduplication survives only the current replay, not reload or a new call.

Reports contain `initialState`, `naive`, and `guarded` results, event timelines, numerical invariants, engine version, and fixture SHA-256. Browser exports add the packaged source SHA-256. Invariant names describe numerical state checks; they do not represent full authorization or replay correctness. No proof of database transaction behavior is claimed.
