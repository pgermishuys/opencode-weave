# Multi-Model Eval Routing & Cross-Repo Dashboard Migration

## TL;DR
> **Summary**: Add a top-level `model` field to JSONL output, run CI evals against both `gpt-4o-mini` (OpenAI) and `claude-sonnet-4-20250514` (Anthropic) via GitHub Models API, remove the HTML dashboard from Weave, and rebuild the Weave Website dashboard with multi-provider comparison views.
> **Estimated Effort**: Large

## Context

### Original Request
Enable multi-model agent routing evals (at least 2 providers: OpenAI + Anthropic) and move the eval reporting dashboard from the Weave repo to the Weave Website with enhanced multi-provider comparison.

### Key Findings

**Weave Repo (C:\source\weave)**
- `EvalRunResult` type (`src/features/evals/types.ts` L243-251) has NO `model` field — only `runId`, `startedAt`, `finishedAt`, `suiteId`, `phase`, `summary`, `caseResults`.
- The model is buried inside each case's `artifacts.baselineDelta.model` (set in `src/features/evals/executors/model-response.ts` L33-37), e.g. `{"provider":"g***s","model":"gpt-4o-mini","durationMs":1083}`.
- The `--model` CLI flag already works — `context.modelOverride` is plumbed through `runner.ts` → `model-response.ts` L25: `const model = context.modelOverride ?? executor.model`.
- All 15 routing eval JSONC case files hardcode `"model": "gpt-4o-mini"` in their executor block, but this is overridden by `--model` at runtime.
- The trend report (`script/eval-trend-report.ts`) normalizes to `model: "unknown"` for main-format runs (L134) because no top-level model field exists.
- CI workflow (`.github/workflows/evals.yml`) runs a single model: `EVAL_MODEL: ${{ inputs.model || 'gpt-4o-mini' }}` (L109).
- JSONL has 13 runs, all from `gpt-4o-mini`, all with the same `EvalRunResult` schema (no top-level `model`).
- Rate limiting: 1000ms between API calls (`DELAY_BETWEEN_CALLS_MS`). 15 cases * 2 models = 30 API calls per CI run, ~30s of delay overhead.
- `docs/evals/index.html` (531 lines) is the dashboard to delete — self-contained with Chart.js, GitHub-dark theme, no framework.
- `appendEvalRunJsonl()` in `storage.ts` just does `JSON.stringify(result)` — adding a field to `EvalRunResult` will automatically include it.
- The LLM judge evaluator is NOT a real LLM call — it's simple string matching (`evaluators/llm-judge.ts`), so no extra API calls per case.

**Weave Website (C:\source\weave-website)**
- `evals/index.html` (744 lines) is the current dashboard — Tailwind + Chart.js, same logic as Weave's but styled with the site's design system.
- Already handles two JSONL formats: "main format" (`EvalRunResult` with `suiteId`/`summary`/`caseResults`) and "spike format" (legacy `model`/`score`/`timestamp`).
- For main format, it hardcodes `model: 'unknown'` in `normalizeMainRun()` (L295) — same problem as the trend report.
- No model filter/selector UI exists currently.
- Static site deployed via Docker/nginx, no build step for the eval page itself.
- Tailwind is pre-built from `src/tailwind.css` → `dist/tailwind.css`.
- The site has `glass-card`, `gradient-text`, `btn-gradient` etc. design system classes.
- Chart color palette defined in `COLORS` object and `caseColors` array.

**Anthropic Model on GitHub Models**
- GitHub Models API supports Anthropic models. The likely candidate is `claude-sonnet-4-20250514` (Claude Sonnet 4) which is available via the same `https://models.inference.ai.azure.com/chat/completions` endpoint.
- The request format (OpenAI-compatible chat completions) should work unchanged — GitHub Models API normalizes the interface.

## Objectives

### Core Objective
Run agent-routing evals against multiple LLM providers through a single CI workflow, tag results with model identity in JSONL, and provide a multi-provider comparison dashboard on the Weave Website.

### Deliverables
- [ ] Top-level `model` field in `EvalRunResult` type and JSONL output
- [ ] CI workflow running the suite against 2+ models sequentially
- [ ] Dashboard removed from Weave `docs/evals/`
- [ ] Enhanced multi-provider dashboard on Weave Website
- [ ] Trend report script updated for model awareness

### Definition of Done
- [ ] `bun run eval --suite agent-routing --jsonl --model gpt-4o-mini` produces JSONL with top-level `model` field
- [ ] CI workflow triggers eval runs for both `gpt-4o-mini` and the chosen Anthropic model
- [ ] `docs/evals/index.html` no longer exists in the Weave repo
- [ ] `evals/index.html` on the website shows model filter/selector and per-provider trend lines
- [ ] All existing tests pass: `bun test` in Weave repo

### Guardrails (Must NOT)
- Must NOT change the GitHub Models API caller itself (temperature, max_tokens, endpoint)
- Must NOT break backward compatibility of JSONL parsing (old entries without `model` must still render)
- Must NOT remove the JSONL results file or trend report script from Weave
- Must NOT add new npm dependencies to either repo
- Must NOT change the eval case JSONC files' default model — the `--model` override handles this

## TODOs

### Phase 1: Model-Tagged JSONL (Weave Repo)

- [x] 1. Add `model` field to `EvalRunResult` type
  **What**: Add optional `model?: string` field to `EvalRunResult` interface. Keep it optional for backward compat with existing JSONL entries that lack it.
  **Files**: `C:\source\weave\src\features\evals\types.ts` (modify `EvalRunResult` interface, ~L243)
  **Acceptance**: `EvalRunResult` type includes `model?: string`

- [x] 2. Populate `model` in the eval runner
  **What**: In `runEvalSuite()`, set `result.model` from `options.modelOverride` or fall back to the first `model-response` executor's model in the suite's cases. Extract model from `context.modelOverride ?? selectedCases[0]?.executor.model` (when executor kind is `model-response`). If no model-response cases exist, leave undefined.
  **Files**: `C:\source\weave\src\features\evals\runner.ts` (modify `runEvalSuite()`, ~L193-201)
  **Acceptance**: Running `bun run eval --suite agent-routing --jsonl --model gpt-4o-mini` writes JSONL with `"model":"gpt-4o-mini"` at the top level of the JSON object

- [x] 3. Update `EvalRunResultSchema` for validation
  **What**: Add optional `model` string field to the Zod schema for `EvalRunResult`.
  **Files**: `C:\source\weave\src\features\evals\schema.ts`
  **Acceptance**: Schema validation passes for objects with and without `model` field

- [x] 4. Update trend report to use top-level `model`
  **What**: In `normalizeMainRun()`, read `run.model ?? 'unknown'` instead of hardcoding `'unknown'`. Also update `MainFormatRun` interface to include optional `model` field.
  **Files**: `C:\source\weave\script\eval-trend-report.ts` (modify `MainFormatRun` interface ~L103, and `normalizeMainRun()` ~L130-146)
  **Acceptance**: Trend report displays actual model name instead of "unknown" for new runs; old runs still show "unknown"

- [x] 5. Update reporter for model awareness
  **What**: In `formatEvalSummary()` and `formatJobSummaryMarkdown()`, include the model name when available (e.g., "Suite agent-routing (routing) — Model: gpt-4o-mini").
  **Files**: `C:\source\weave\src\features\evals\reporter.ts`
  **Acceptance**: Console and job summary output includes model name

### Phase 2: Multi-Model CI (Weave Repo)

- [x] 6. Update CI workflow for multi-model runs
  **What**: Modify the `agent-routing` job to use a matrix strategy running the suite once per model. Use `strategy.matrix.model: [gpt-4o-mini, claude-sonnet-4-20250514]`. Each matrix leg runs `bun run eval --suite agent-routing --jsonl --model ${{ matrix.model }}` and commits the JSONL. To avoid git conflicts from parallel commits, run the matrix serially (`max-parallel: 1`) and pull before pushing.
  **Files**: `C:\source\weave\.github\workflows\evals.yml` (modify `agent-routing` job, ~L81-135)
  **Details**:
  - Add `strategy.matrix.model: [gpt-4o-mini, claude-sonnet-4-20250514]` with `max-parallel: 1`
  - Update step names to include `${{ matrix.model }}`
  - Update the artifact name to include model: `routing-eval-artifacts-${{ matrix.model }}`
  - Update `workflow_dispatch.inputs.model` description to note it can be overridden but matrix runs both by default
  - Consider: When `workflow_dispatch` provides a specific model, should it run only that model or still run the matrix? Suggest: if `inputs.model` is set and not the default, run only that model; otherwise run the full matrix. This can be handled with a `matrix.model` that's conditionally set.
  **Acceptance**: CI runs eval suite against both models, commits two separate JSONL entries per trigger, each tagged with its model

- [x] 7. Validate Anthropic model string
  **What**: Before finalizing the workflow, verify the exact model ID string for Anthropic on GitHub Models API. The model string must be the one accepted by `https://models.inference.ai.azure.com/chat/completions`. Candidates: `claude-sonnet-4-20250514`, `claude-3.5-sonnet`, or similar. Run a quick test or check GitHub Models docs.
  **Files**: None (research/validation step)
  **Acceptance**: Confirmed working model string for Anthropic via GitHub Models API
  **Risk**: If the model string is wrong, CI will fail with 400/404. Document the fallback: use `claude-3.5-sonnet` or check `https://github.com/marketplace/models` for available Anthropic models.

### Phase 3: Remove Dashboard from Weave (Weave Repo)

- [x] 8. Delete `docs/evals/index.html` from Weave
  **What**: Remove the self-contained HTML dashboard from the Weave repo. The dashboard now lives on the Weave Website.
  **Files**: Delete `C:\source\weave\docs\evals\index.html`. If `docs/evals/` becomes empty, remove the directory. Check if `docs/` has other contents; if only `evals/`, remove `docs/` entirely.
  **Acceptance**: `docs/evals/index.html` no longer exists in the repo

- [x] 9. Evaluate trend report script scope
  **What**: The trend report script (`script/eval-trend-report.ts`, 761 lines) provides console output + GitHub Job Summary. It should stay in the Weave repo as it's CI tooling. However, consider if the Job Summary markdown should be enhanced with model info (already covered in TODO 4-5). No move needed.
  **Files**: None (decision documented here)
  **Acceptance**: Trend report stays in Weave repo, generates model-aware output

### Phase 4: Enhanced Multi-Provider Dashboard (Weave Website)

- [x] 10. Add model filter/selector UI
  **What**: Add a provider/model dropdown or toggle bar above the stats grid. Extract unique model names from parsed runs. Default to "All Models" view. When a specific model is selected, filter all data to that model. Use Tailwind-styled buttons or a `<select>` matching the site's `glass-card` aesthetic.
  **Files**: `C:\source\weave-website\evals\index.html` (modify the `renderDashboard()` function and add HTML for the selector)
  **Details**:
  - Extract models: `const models = [...new Set(runs.map(r => r.model).filter(m => m !== 'unknown'))].sort()`
  - Render a button group or dropdown above stats grid
  - On filter change, re-render dashboard with filtered runs
  - Show the selected model(s) in active state
  **Acceptance**: Dashboard shows model selector; selecting a model filters all charts/tables to that model's data

- [x] 11. Update JSONL normalization to use top-level `model`
  **What**: Update `normalizeMainRun()` to read `run.model ?? 'unknown'` instead of hardcoding `'unknown'`. This mirrors the change in the trend report script. Old JSONL entries without `model` still default to `'unknown'`.
  **Files**: `C:\source\weave-website\evals\index.html` (modify `normalizeMainRun()`, ~L292-309)
  **Acceptance**: New JSONL entries display with their real model name; old entries show "unknown"

- [x] 12. Add per-provider score trend lines
  **What**: Modify the Score Trend chart to show one line per model instead of a single aggregated line. Use different colors from the brand palette (`COLORS.blue` for OpenAI, `COLORS.purple` for Anthropic). When "All Models" is selected, show overlaid lines. When a specific model is selected, show only that model's line.
  **Files**: `C:\source\weave-website\evals\index.html` (modify score chart creation, ~L541-571)
  **Details**:
  - Group runs by model: `const runsByModel = groupBy(runs, r => r.model)`
  - Create one dataset per model with distinct colors
  - Model color map: `{ 'gpt-4o-mini': COLORS.blue, 'claude-sonnet-4-20250514': COLORS.purple, 'unknown': COLORS.slate }`
  - Still show the 80% threshold line
  **Acceptance**: Score trend chart shows separate, color-coded lines per model

- [x] 13. Add per-provider trend to duration and pass rate charts
  **What**: Apply the same per-model grouping to the Duration and Pass Rate charts. Duration chart: grouped bars per model. Pass Rate chart: overlaid lines per model.
  **Files**: `C:\source\weave-website\evals\index.html` (modify duration and pass rate chart creation, ~L574-620)
  **Acceptance**: Duration and pass rate charts show per-model data with color coding

- [x] 14. Add provider breakdown to stats cards
  **What**: When "All Models" is selected, show per-model latest scores in the stats cards area. Add a row of mini-cards or sub-stats below the main stats grid showing each model's latest score, pass rate, and delta. When a single model is selected, show only that model's stats (current behavior, but with model name displayed).
  **Files**: `C:\source\weave-website\evals\index.html` (modify stats grid rendering, ~L468-501)
  **Details**:
  - For each model, find its latest run and compute stats
  - Show: model name, latest score, pass rate, run count
  - Style: smaller `glass-card` items in a sub-grid
  **Acceptance**: Stats area shows per-model breakdown when "All Models" is selected

- [x] 15. Add per-case model comparison table
  **What**: Add a new section below the existing Case Stability table: "Model Comparison" table showing each case as a row with columns for each model's latest score, pass rate, and status. This enables direct side-by-side comparison of how each model performs on each routing case.
  **Files**: `C:\source\weave-website\evals\index.html` (add new table section after case stability, ~after L538)
  **Details**:
  - Columns: Case ID | Description | Model A Score | Model A Status | Model B Score | Model B Status | Winner
  - Build from `buildCaseHistory()` per model
  - "Winner" column shows which model performs better on that case
  - Color-code cells: green for higher score, red for lower
  **Acceptance**: Model comparison table renders with per-case, per-model scores; identifies which model is better per case

- [x] 16. Update case stability table for model awareness
  **What**: Extend the Case Stability table to include a "Model" column or, when "All Models" is selected, show trend dots per model. When a specific model is selected, show only that model's data (existing behavior).
  **Files**: `C:\source\weave-website\evals\index.html` (modify case stability table, ~L660-689)
  **Acceptance**: Case stability table is model-aware; when filtered to a model, shows only that model's trends

- [x] 17. Add model legend / color key
  **What**: Add a small legend below the header showing the color mapping for each model (e.g., blue dot = gpt-4o-mini, purple dot = claude-sonnet-4-20250514). This appears only when multiple models have data.
  **Files**: `C:\source\weave-website\evals\index.html` (add legend HTML in the header area, ~L170-178)
  **Acceptance**: Color legend renders when multiple models have data

## Verification

- [x] All existing Weave tests pass: `bun test` in `C:\source\weave`
- [x] JSONL backward compatibility: old entries (without `model`) still parse and render correctly on dashboard
- [x] New JSONL entries include top-level `model` field
- [x] CI workflow runs both models without errors
- [x] Dashboard model filter works: selecting a model shows only that model's data
- [x] Dashboard "All Models" view shows overlaid comparison
- [x] `docs/evals/index.html` is removed from Weave repo
- [x] Website dashboard is accessible at `/evals/` with no build changes needed

## Open Questions & Risks

1. **Anthropic model ID on GitHub Models**: The exact model string needs validation. `claude-sonnet-4-20250514` is the likely candidate but may differ. Check GitHub Marketplace Models page or test with the API. Fallback: `claude-3.5-sonnet`.

2. **Rate limiting with 2x models**: Currently 15 cases with 1s delay = ~15s per model run. With 2 models running serially in CI (`max-parallel: 1`), total time doubles to ~60s for API calls alone. This is acceptable for a weekly/on-demand job but worth monitoring.

3. **JSONL file size**: Both models append to the same `evals/results/agent-routing.jsonl` file. Over time this grows faster (2 entries per trigger). The JSONL lines are verbose (include full rendered prompts in artifacts). Consider future compression or retention policy, but not in scope now.

4. **Git commit conflicts**: With `max-parallel: 1`, each model run commits and pushes sequentially. The second run must `git pull --rebase` before pushing. This is already handled in the workflow but may fail if timing is tight. The existing `git pull --rebase || true` pattern should suffice.

5. **GitHub Models API quota**: Running 2x the API calls per CI trigger. GitHub Models has rate limits per token/organization. Monitor for 429 errors. The 1s delay between calls already provides some protection.

6. **Dashboard backward compat**: Old JSONL entries have `model: 'unknown'` after normalization. The model filter should handle this gracefully — either show an "Unknown" option or group those under a "Legacy" label.

## Dependency Order

```
Phase 1 (TODO 1-5) → Phase 2 (TODO 6-7) → Phase 3 (TODO 8-9)
                                         ↘ Phase 4 (TODO 10-17) — can start after TODO 1-2 are merged
```

Phase 4 (Website) depends on Phase 1 (model field in JSONL) being deployed to produce new data. Phases 3 and 4 are independent of each other. Phase 2 depends on Phase 1.
