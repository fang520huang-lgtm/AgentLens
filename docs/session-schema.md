# Session artifact v1

`session.json` is the normalized, versioned AgentLens artifact. Its [JSON Schema](../schema/session-v1.schema.json) is intended for CI jobs, PR bots, benchmarks, and future replay tools. Unknown fields may be added without changing `schemaVersion`; consumers should ignore fields they do not recognize.

Key fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Artifact format version; currently `1`. |
| `agentlensVersion`, `codexVersion`, `model` | Producer version and requested Codex model. `model` is `null` when Codex chooses its default. |
| `platform`, `sandbox` | Runtime OS/architecture and requested Codex sandbox. |
| `gitCommit`, `dirtyBefore`, `dirtyAfter` | Git state; `null` means unavailable, such as a non-Git workspace. |
| `outcome` | `completed`, `failed`, `interrupted`, or `recovered`. |
| `captureCoverage` | Text files captured/skipped at run start and end, with skip reasons. |
| `timeline`, `viewedFiles`, `changes` | Captured actions, inferred reads, and workspace patches. |
| `usage` | Codex token counts summed across completed turns. |

Time fields are UTC ISO 8601 strings. `events.jsonl` retains the original Codex event object inside each `{ "at", "event" }` record. `meta.json` is written before Codex starts so `agentlens recover <run>` can reconstruct a timeline after a crash. Recovered artifacts may lack patches because the final workspace snapshot was never completed.

`session.json` and the local `index.html` contain original data. `agentlens export` produces a redacted HTML copy by default. Pattern matching cannot guarantee every secret is removed; review any export before posting it publicly.
