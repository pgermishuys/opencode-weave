# Multi-Model Agent Evals Design

> [!IMPORTANT]
> **This page documents the legacy `@opencode_weave/weave` plugin, which is no longer maintained.** Weave has moved to [weave-io/weave](https://github.com/weave-io/weave) and is documented at [tryweave.io/docs](https://tryweave.io/docs/). To move over and keep your agents and prompts, follow [Upgrading from legacy Weave](https://tryweave.io/docs/upgrade-from-legacy/).

## Preferred decision

Use **one canonical JSONL file per suite** as the source of truth:

- canonical store: `evals/results/{suite}.jsonl`
- one JSONL line = one suite run
- each run carries explicit optional top-level `runMetadata`
- downstream tools group by `runMetadata.modelKey`
- any per-model files or summary JSON are **derived artifacts**, not the primary store

This is the preferred phase-1 design because it preserves history in one stream, keeps fetch paths stable, avoids cross-file backfill work, and supports side-by-side model comparison without adding a backend.

## Tradeoff summary

### Preferred: single canonical JSONL

**Pros**

- preserves one continuous history per suite
- simplest append/read contract for `script/eval.ts`, CI, and the website
- easiest backward compatibility with existing `agent-routing.jsonl` readers
- makes known-history backfill straightforward

**Cons**

- trend tooling and UI must group by model instead of assuming one stream
- larger files may later justify a derived summary artifact

### Rejected for phase 1: per-model canonical files

**Pros**

- simpler per-model charting

**Cons**

- fragments history
- complicates comparison across models
- makes known-history backfill and future fan-in harder
- adds more fetch URLs and more CI write paths

## CI matrix recommendation

Use a two-level comparison identity:

- required dimensions: `provider`, `model`
- keep `suite` outside the model matrix when possible
- capture `trigger`, `branch`, `commitSha`, and similar values as metadata, not matrix identity

Recommended initial scope:

- keep deterministic suites unchanged
- make live `agent-routing` a curated matrix over **3-5 models total**
- do **not** add prompt version, temperature, or region as matrix axes in phase 1

Recommended workflow shape in `.github/workflows/evals.yml`:

1. matrix job runs one `{ provider, model }` cell
2. each cell executes `bun run eval --suite agent-routing --jsonl --provider ... --model ...`
3. each cell uploads a run artifact and exposes the same provider/model in the artifact name and job summary
4. a single fan-in job downloads all artifacts and performs the only append/commit to `evals/results/agent-routing.jsonl`

This fan-in step is the preferred race-condition mitigation. Matrix cells should **not** all push directly to the same JSONL file.

## Result schema recommendation

Extend `EvalRunResult` with optional run-level metadata:

```ts
runMetadata?: {
  provider?: string
  model?: string
  modelKey?: string
  source?: "local" | "ci" | "scheduled" | "workflow_dispatch"
  repo?: string
  branch?: string
  commitSha?: string
  workflow?: string
  job?: string
  matrix?: Record<string, string>
}
```

Notes:

- keep `runMetadata` optional so historical rows still validate
- prefer `runMetadata` over new flat top-level keys because CI context will likely grow
- do **not** duplicate provider/model onto every case result in phase 1
- only add per-case metadata for real grouping needs, e.g. `caseResults[].metadata?.scenarioTags?: string[]`

## Storage strategy recommendation

Phase 1 should write **only** the canonical combined JSONL:

- `evals/results/{suite}.jsonl`

Optional later derivatives:

- `evals/results/{suite}--{provider}--{model}.jsonl`
- generated summary JSON for the website

Historical handling:

- keep `evals/results/agent-routing.jsonl` as the canonical history file
- backfill known unlabeled rows to:
  - `provider = github-models`
  - `model = gpt-4o`
  - `modelKey = github-models/gpt-4o`
- do not split old and new history into separate files
- only use `unknown` when provenance is genuinely unknown

## Trend-report recommendation

Update `script/eval-trend-report.ts` normalization so main-format runs resolve model identity as:

```ts
runMetadata.modelKey ?? knownBackfillValue ?? "unknown"
```

Recommended behavior:

- default trend analysis is **per model stream**
- add `--model-key <provider/model>` to filter a single stream
- add `--compare-models` for the latest per-model comparison table
- keep aggregate mixed-model reporting opt-in only

Recommended outputs:

- per-model score trend
- latest-run comparison table across models
- per-case comparison matrix for the latest run of each model

Mixed-model lines should not be the default trend view because they create misleading trajectories.

## Website data model and UI

Phase 1 website should keep a **single fetch** to the canonical suite JSONL and normalize rows client-side to:

```ts
{
  suiteId,
  timestamp,
  modelKey,
  provider,
  model,
  score,
  passedCases,
  totalCases,
  durationMs,
  caseResults: [{ caseId, description, passed, score }]
}
```

Recommended UI in `/Users/pgermishuys/source/weave-website/evals/index.html`:

- top filter bar: suite selector, model multi-select, latest-only/trend toggle
- summary cards: best latest model, worst latest model, score spread, total models tracked
- score trend chart: one line per selected model
- primary comparison surface: **scenario-by-model matrix** with case rows and model columns
- detail table: sortable by spread, failure count, or pass rate
- optional model detail drawer for one model's history

Target cell behavior:

- primary cell content = latest pass/fail + normalized score shown as a percentage
- secondary cell content = compact last-6-run history for that case/model pair
- model summaries show passed cases, total cases, and pass rate
- historical unlabeled `gpt-4o` rows appear inline as `github-models/gpt-4o`, not as a legacy bucket

## Phased rollout

1. **Schema + history backfill**
   - add optional `runMetadata.provider/model/modelKey`
   - persist metadata on new runs
   - backfill known unlabeled `agent-routing` rows as `github-models/gpt-4o`
2. **CI matrix pilot**
   - run `agent-routing` for 2-3 curated models
   - fan in artifacts into the same canonical JSONL
3. **Reporting + website compare views**
   - per-model trend output
   - latest cross-model scenario matrix
   - compact last-6-run per-case history
4. **Derived artifacts only if needed**
   - add generated summary JSON or per-model exports only when perf/load proves it necessary

## Backward compatibility guidance

- keep schema additions optional
- keep existing main-format detection valid
- preserve file order and historical semantics
- backfill only when provenance is known with certainty
- centralize `modelKey` normalization to prevent naming drift

Known pitfalls and mitigations:

- **matrix commit races** → use artifact fan-in and one writer job
- **misleading merged trends** → default to per-model charts
- **changing matrix membership** → treat "best model" as latest-run scoped, not all-time absolute
- **large JSONL files** → add derived summary JSON later if needed
- **naming drift** → normalize `modelKey` centrally in runner/storage/reporting
- **incorrect backfill** → make the backfill script explicit, one-time, and limited to known history

## Exact files to change

### Weave repo

- `src/features/evals/types.ts` — add `runMetadata` types
- `src/features/evals/schema.ts` — validate old rows and new rows with optional `runMetadata`
- `src/features/evals/runner.ts` — populate run metadata from execution context
- `script/eval.ts` — pass CLI/CI metadata into the run result
- `src/features/evals/storage.ts` — preserve canonical JSONL append path; optionally host normalization helpers
- `.github/workflows/evals.yml` — convert live routing job to provider/model matrix + fan-in writer job
- `script/eval-trend-report.ts` — group/filter/compare by `modelKey`
- `evals/results/agent-routing.jsonl` — one-time known-history backfill to `github-models/gpt-4o`
- optional new one-off script such as `script/eval-backfill-known-history.ts` for explicit backfill

### Website repo

- `/Users/pgermishuys/source/weave-website/evals/index.html` — single-fetch multi-model normalization, comparison matrix, per-model trends, summary cards, last-6-run compact history

## Why this is the preferred architecture

It satisfies the request with the smallest safe change set:

- no backend service
- one canonical history file per suite
- no broken readers while old rows still exist
- known unlabeled history preserved and made comparable
- CI, reporting, and UI all share the same minimum viable comparison key: `provider + model`
