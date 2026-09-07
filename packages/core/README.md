# @ftb/core

The shared registry library: parse snapshots and deltas, apply deltas, serialise both formats byte-compatibly, the DL/SO/SB date semantics, the five-tier queue and the radar. Pure TypeScript, no runtime dependencies, consumed as source (`src/index.ts`) by the service, the client and the MCP server.

| Module | Purpose |
|---|---|
| `types.ts` | The `Task` shape from `docs/api-contract.md`; `Snapshot`, `Delta`, `Change`. |
| `fields.ts` | Cell conversions; the documented `deadline_kind` and `blocker` heuristics. |
| `parse-snapshot.ts` | `Task Registry — …` → `{ stamp, preamble, rows, postamble, counts?, nextFreeId? }`. Escaped pipes survive; Notes are never lost. |
| `parse-delta.ts` | `Registry Delta — …` → `{ stamp, base, priorDeltas, changes, forNextCompaction? }`. Splits on `" | "`, so names with parentheses parse. |
| `apply-delta.ts` | Field-by-field application: unmentioned fields untouched, `note+=` appends a line, `Deadline=none` clears the date, `NEW` adds, `RENUMBERED FROM` moves. |
| `serialize.ts` | The table (round-trips the real snapshot byte for byte) and the delta file. |
| `dates.ts` | `dleft`, `offsetDate` (months → clamp → weeks → days), `dstate`, `isOverdue`, `inFortnight`, `quadrant`, `cycleMonday`, and the Europe/Sofia clock (`sofiaStamp`, `sofiaToday`, `sofiaTimestamp`). |
| `queue.ts` | `buildQueue` (five tiers, branches as entries, ISO-week exclusion), `buildRadar`, `nextFreeId`, `reservedIds`. |
| `registry.ts` | `resolveRegistry(files)`: newest snapshot + later deltas, the protocol's READ procedure. |

Tests run against the real files in `data/registry` when present (they are gitignored) and skip otherwise.
